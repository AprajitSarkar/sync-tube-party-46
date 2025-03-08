
import React, { useState, useEffect, useRef } from 'react';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Play, Pause, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { CustomButton } from '@/components/ui/custom-button';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from '@/hooks/use-mobile';

interface VideoPlayerProps {
  roomId: string;
  userId: string;
}

interface VideoState {
  videoId: string;
  isPlaying: boolean;
  currentTime: number;
  timestamp: number;
}

interface PlaylistItem {
  id: string;
  video_id: string;
  title: string;
  position: number;
}

const VideoPlayer = ({ roomId, userId }: VideoPlayerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [localIsPlaying, setLocalIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const syncIntervalRef = useRef<number | null>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const isMobile = useIsMobile();
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentVideoPosition, setCurrentVideoPosition] = useState<number | null>(null);

  useEffect(() => {
    if (roomId) {
      fetchInitialState();
      fetchRoomPlaylist();
      
      // Subscribe to video state changes
      const videoStateSubscription = supabase
        .channel(`room_video_state:${roomId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'video_rooms',
          filter: `id=eq.${roomId}`
        }, (payload) => {
          const newState = payload.new as any;
          if (newState && newState.video_state) {
            handleVideoStateChange(newState.video_state);
          }
        })
        .subscribe();
      
      // Subscribe to playlist changes
      const playlistSubscription = supabase
        .channel(`room_playlist:${roomId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'playlist_items',
          filter: `room_id=eq.${roomId}`
        }, () => {
          fetchRoomPlaylist();
        })
        .subscribe();

      // Cleanup subscriptions
      return () => {
        videoStateSubscription.unsubscribe();
        playlistSubscription.unsubscribe();
        
        if (syncIntervalRef.current) {
          window.clearInterval(syncIntervalRef.current);
        }
      };
    }
  }, [roomId]);

  const fetchRoomPlaylist = async () => {
    try {
      const { data, error } = await supabase
        .from('playlist_items')
        .select('*')
        .eq('room_id', roomId)
        .order('position', { ascending: true });
      
      if (error) throw error;
      
      setPlaylist(data || []);
      updateCurrentVideoPosition();
    } catch (error) {
      console.error('Error fetching room playlist:', error);
    }
  };

  const updateCurrentVideoPosition = () => {
    if (!videoState?.videoId || !playlist.length) {
      setCurrentVideoPosition(null);
      return;
    }

    const index = playlist.findIndex(item => item.video_id === videoState.videoId);
    setCurrentVideoPosition(index !== -1 ? index : null);
  };

  useEffect(() => {
    updateCurrentVideoPosition();
  }, [videoState?.videoId, playlist]);

  const fetchInitialState = async () => {
    try {
      const { data, error } = await supabase
        .from('video_rooms')
        .select('video_state')
        .eq('id', roomId)
        .single();
      
      if (error) throw error;
      
      if (data && data.video_state) {
        // Validate that the video is in the playlist
        const videoId = data.video_state.videoId;
        
        if (videoId) {
          const isInPlaylist = playlist.some(item => item.video_id === videoId);
          
          if (isInPlaylist || playlist.length === 0) {
            setVideoState(data.video_state);
            setLocalIsPlaying(data.video_state.isPlaying);
          } else {
            // If video is not in playlist and playlist is not empty, play the first video
            if (playlist.length > 0) {
              const firstVideo = playlist[0];
              updateRoomVideoState({
                videoId: firstVideo.video_id,
                isPlaying: true,
                currentTime: 0
              });
            }
          }
        } else {
          setVideoState(data.video_state);
          setLocalIsPlaying(data.video_state.isPlaying);
        }
      }
    } catch (error) {
      console.error('Error fetching initial state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVideoStateChange = (newState: VideoState) => {
    // Don't process if we just sent this update
    if (Date.now() - lastSyncTimeRef.current < 1000) {
      return;
    }

    // Check if the video is in the playlist before accepting state change
    if (newState.videoId) {
      const isInPlaylist = playlist.some(item => item.video_id === newState.videoId);
      
      if (!isInPlaylist && playlist.length > 0) {
        console.log("Ignoring state change for video not in playlist:", newState.videoId);
        return;
      }
    }

    setVideoState(newState);
    
    if (playerRef.current) {
      // Handle video ID change
      if (newState.videoId !== videoState?.videoId) {
        // Video has changed, no need to sync time/play state since it will load fresh
        setLocalIsPlaying(newState.isPlaying);
        return;
      }

      // Handle play/pause
      if (newState.isPlaying !== localIsPlaying) {
        if (newState.isPlaying) {
          playerRef.current.playVideo();
        } else {
          playerRef.current.pauseVideo();
        }
        setLocalIsPlaying(newState.isPlaying);
      }

      // Handle time change (seek) if difference is significant (>3 seconds)
      const playerTime = playerRef.current.getCurrentTime();
      const timeDiff = Math.abs(playerTime - newState.currentTime);
      
      if (timeDiff > 3) {
        playerRef.current.seekTo(newState.currentTime, true);
      }
    }
  };

  const updateRoomVideoState = (updateData: Partial<VideoState>) => {
    if (!roomId || !videoState) return;
    
    // If updating videoId, check if it's in the playlist
    if (updateData.videoId && playlist.length > 0) {
      const isInPlaylist = playlist.some(item => item.video_id === updateData.videoId);
      
      if (!isInPlaylist) {
        console.log("Attempted to play video not in playlist:", updateData.videoId);
        toast({
          title: "Can't play video",
          description: "This video is not in the room playlist",
          variant: "destructive"
        });
        return;
      }
    }
    
    lastSyncTimeRef.current = Date.now();
    
    const updatedState = {
      ...videoState,
      ...updateData,
      timestamp: Date.now()
    };
    
    setVideoState(updatedState);
    
    // Update the database
    supabase
      .from('video_rooms')
      .update({ video_state: updatedState })
      .eq('id', roomId)
      .then(({ error }) => {
        if (error) {
          console.error('Error updating video state:', error);
        }
      });
  };

  const onPlayerReady = (event: YouTubeEvent) => {
    playerRef.current = event.target;
    setIsLoading(false);
    
    // Set initial volume and apply mute state
    event.target.setVolume(70);
    if (isMuted) {
      event.target.mute();
    }
    
    // If there's an initial state, seek to the correct time
    if (videoState) {
      // Verify the video is in playlist before playing
      const isInPlaylist = playlist.some(item => item.video_id === videoState.videoId);
      
      if (isInPlaylist || playlist.length === 0) {
        // Add a small delay to make sure player is ready
        setTimeout(() => {
          if (playerRef.current) {
            // Add 1 second to account for delay if the video should be playing
            const adjustedTime = videoState.isPlaying 
              ? videoState.currentTime + 1
              : videoState.currentTime;
              
            playerRef.current.seekTo(adjustedTime, true);
            
            if (videoState.isPlaying) {
              playerRef.current.playVideo();
            }
          }
        }, 500);
      }
    }
  };

  const onPlayerStateChange = (event: YouTubeEvent) => {
    // Handle player state changes
    switch (event.data) {
      case YouTube.PlayerState.PLAYING:
        setLocalIsPlaying(true);
        setIsBuffering(false);
        
        // Only update room state if the local user initiated the play
        if (!videoState?.isPlaying) {
          updateRoomVideoState({ 
            isPlaying: true,
            currentTime: playerRef.current?.getCurrentTime() || 0
          });
        }
        
        // Set up regular sync interval when playing
        if (syncIntervalRef.current) {
          window.clearInterval(syncIntervalRef.current);
        }
        
        syncIntervalRef.current = window.setInterval(() => {
          if (playerRef.current && videoState) {
            updateRoomVideoState({
              currentTime: playerRef.current.getCurrentTime()
            });
          }
        }, 15000) as unknown as number;
        
        break;
        
      case YouTube.PlayerState.PAUSED:
        setLocalIsPlaying(false);
        setIsBuffering(false);
        
        // Only update room state if the local user initiated the pause
        if (videoState?.isPlaying) {
          updateRoomVideoState({ 
            isPlaying: false,
            currentTime: playerRef.current?.getCurrentTime() || 0
          });
        }
        
        // Clear sync interval when paused
        if (syncIntervalRef.current) {
          window.clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
        
        break;
        
      case YouTube.PlayerState.BUFFERING:
        setIsBuffering(true);
        break;
        
      case YouTube.PlayerState.ENDED:
        setLocalIsPlaying(false);
        if (syncIntervalRef.current) {
          window.clearInterval(syncIntervalRef.current);
          syncIntervalRef.current = null;
        }
        
        // Play next video if available
        playNextVideo();
        break;
        
      default:
        break;
    }
  };

  const togglePlayPause = () => {
    if (!playerRef.current) return;
    
    if (localIsPlaying) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const toggleMute = () => {
    if (!playerRef.current) return;
    
    if (isMuted) {
      playerRef.current.unMute();
    } else {
      playerRef.current.mute();
    }
    
    setIsMuted(!isMuted);
  };

  const playNextVideo = () => {
    if (playlist.length === 0 || currentVideoPosition === null) {
      // If it's the last video in playlist, start from the beginning
      if (playlist.length > 0) {
        playVideoFromPlaylist(playlist[0].video_id);
        toast({
          title: 'Playlist restarted',
          description: 'Playing from the beginning of the playlist'
        });
      }
      return;
    }
    
    const nextIndex = (currentVideoPosition + 1) % playlist.length;
    const nextVideo = playlist[nextIndex];
    
    if (nextVideo) {
      playVideoFromPlaylist(nextVideo.video_id);
      toast({
        title: 'Playing next',
        description: nextVideo.title
      });
    }
  };

  const playVideoFromPlaylist = (videoId: string) => {
    // Verify the video is in the playlist
    const isInPlaylist = playlist.some(item => item.video_id === videoId);
    
    if (!isInPlaylist && playlist.length > 0) {
      console.log("Attempted to play video not in playlist:", videoId);
      toast({
        title: "Can't play video",
        description: "This video is not in the room playlist",
        variant: "destructive"
      });
      return;
    }
    
    updateRoomVideoState({
      videoId,
      isPlaying: true,
      currentTime: 0
    });
  };

  const getVideoOptions = () => {
    const commonOpts = {
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        fs: 1,
        modestbranding: 1
      }
    };
    
    // Additional mobile-specific options
    if (isMobile) {
      return {
        ...commonOpts,
        width: '100%',
        height: '100%'
      };
    }
    
    // Desktop options
    return {
      ...commonOpts,
      width: '100%',
      height: '480'
    };
  };

  return (
    <div className="relative">
      {isLoading ? (
        <div className="w-full h-[300px] md:h-[480px] flex justify-center items-center bg-black/50">
          <Skeleton className="w-full h-full" />
        </div>
      ) : !videoState?.videoId ? (
        <div className="w-full h-[300px] md:h-[480px] flex justify-center items-center bg-black/50">
          <div className="text-center">
            <p className="text-muted-foreground">No video selected</p>
            <p className="text-xs text-muted-foreground mt-2">
              Search or add a video from your playlists
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative w-full bg-black">
            <YouTube
              videoId={videoState.videoId}
              opts={getVideoOptions()}
              onReady={onPlayerReady}
              onStateChange={onPlayerStateChange}
              className="w-full"
            />
            
            {isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="loading-spinner"></div>
              </div>
            )}
          </div>
          
          <div className="p-2 flex justify-between items-center bg-black/90">
            <div className="flex items-center gap-2">
              <CustomButton
                size="icon"
                variant="ghost"
                onClick={togglePlayPause}
                className="text-white"
              >
                {localIsPlaying ? <Pause size={20} /> : <Play size={20} />}
              </CustomButton>
              
              <CustomButton
                size="icon"
                variant="ghost"
                onClick={playNextVideo}
                className="text-white"
              >
                <SkipForward size={20} />
              </CustomButton>
              
              <CustomButton
                size="icon"
                variant="ghost"
                onClick={toggleMute}
                className="text-white"
              >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </CustomButton>
            </div>
            
            <div className="text-xs text-muted-foreground">
              {playlist.length > 0 && currentVideoPosition !== null ? (
                <span>
                  {currentVideoPosition + 1} of {playlist.length}
                </span>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VideoPlayer;
