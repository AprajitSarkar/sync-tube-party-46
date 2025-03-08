import React, { useState, useEffect, useRef } from 'react';
import YouTube, { YouTubePlayer, YouTubeEvent } from 'react-youtube';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Play, Pause, SkipForward, Volume2, VolumeX, Maximize2 } from 'lucide-react';
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
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (roomId) {
      fetchInitialState();
      fetchRoomPlaylist();
      
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
        const videoId = data.video_state.videoId;
        
        if (videoId) {
          const isInPlaylist = playlist.some(item => item.video_id === videoId);
          
          if (isInPlaylist || playlist.length === 0) {
            setVideoState(data.video_state);
            setLocalIsPlaying(data.video_state.isPlaying);
          } else {
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
    if (Date.now() - lastSyncTimeRef.current < 1000) {
      return;
    }

    if (newState.videoId) {
      const isInPlaylist = playlist.some(item => item.video_id === newState.videoId);
      
      if (!isInPlaylist && playlist.length > 0) {
        console.log("Ignoring state change for video not in playlist:", newState.videoId);
        return;
      }
    }

    setVideoState(newState);
    
    if (playerRef.current) {
      if (newState.videoId !== videoState?.videoId) {
        setLocalIsPlaying(newState.isPlaying);
        return;
      }

      if (newState.isPlaying !== localIsPlaying) {
        if (newState.isPlaying) {
          playerRef.current.playVideo();
          setLocalIsPlaying(true);
        } else {
          playerRef.current.pauseVideo();
          setLocalIsPlaying(false);
        }
      }

      const playerTime = playerRef.current.getCurrentTime();
      const timeDiff = Math.abs(playerTime - newState.currentTime);
      
      if (timeDiff > 2) {
        playerRef.current.seekTo(newState.currentTime, true);
      }
    }
  };

  const updateRoomVideoState = (updateData: Partial<VideoState>) => {
    if (!roomId || !videoState) return;
    
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
    
    event.target.setVolume(70);
    if (isMuted) {
      event.target.mute();
    }
    
    if (videoState) {
      const isInPlaylist = playlist.some(item => item.video_id === videoState.videoId);
      
      if (isInPlaylist || playlist.length === 0) {
        setTimeout(() => {
          if (playerRef.current) {
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
    switch (event.data) {
      case YouTube.PlayerState.PLAYING:
        setLocalIsPlaying(true);
        setIsBuffering(false);
        
        if (!videoState?.isPlaying) {
          updateRoomVideoState({ 
            isPlaying: true,
            currentTime: playerRef.current?.getCurrentTime() || 0
          });
        }
        
        if (syncIntervalRef.current) {
          window.clearInterval(syncIntervalRef.current);
        }
        
        syncIntervalRef.current = window.setInterval(() => {
          if (playerRef.current && videoState) {
            updateRoomVideoState({
              currentTime: playerRef.current.getCurrentTime()
            });
          }
        }, 5000) as unknown as number;
        
        break;
        
      case YouTube.PlayerState.PAUSED:
        setLocalIsPlaying(false);
        setIsBuffering(false);
        
        if (videoState?.isPlaying) {
          updateRoomVideoState({ 
            isPlaying: false,
            currentTime: playerRef.current?.getCurrentTime() || 0
          });
        }
        
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

  const toggleFullscreen = () => {
    if (!playerRef.current) return;
    
    const iframe = document.querySelector('iframe');
    if (!iframe) return;
    
    if (!fullscreen) {
      if (iframe.requestFullscreen) {
        iframe.requestFullscreen();
      } else if ((iframe as any).webkitRequestFullscreen) {
        (iframe as any).webkitRequestFullscreen();
      } else if ((iframe as any).mozRequestFullScreen) {
        (iframe as any).mozRequestFullScreen();
      } else if ((iframe as any).msRequestFullscreen) {
        (iframe as any).msRequestFullscreen();
      }
      setFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
      setFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const getVideoOptions = () => {
    const commonOpts = {
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        fs: 1,
        modestbranding: 1,
        playsinline: 1
      }
    };
    
    if (isMobile) {
      return {
        ...commonOpts,
        width: '100%',
        height: '240'
      };
    }
    
    return {
      ...commonOpts,
      width: '100%',
      height: '480'
    };
  };

  return (
    <div className="relative">
      {isLoading ? (
        <div className="w-full h-[240px] md:h-[480px] flex justify-center items-center bg-black/50">
          <Skeleton className="w-full h-full" />
        </div>
      ) : !videoState?.videoId ? (
        <div className="w-full h-[240px] md:h-[480px] flex justify-center items-center bg-black/50">
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
            
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground mr-2">
                {playlist.length > 0 && currentVideoPosition !== null ? (
                  <span>
                    {currentVideoPosition + 1} of {playlist.length}
                  </span>
                ) : null}
              </div>
              
              <CustomButton
                size="icon"
                variant="ghost"
                onClick={toggleFullscreen}
                className="text-white"
              >
                <Maximize2 size={20} />
              </CustomButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VideoPlayer;
