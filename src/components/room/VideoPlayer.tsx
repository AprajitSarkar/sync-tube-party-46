import React, { useRef, useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Maximize2, Play, Pause, Link2, SkipForward, SkipBack, Share2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_YOUTUBE_API_KEY = 'AIzaSyB-qDaqVOnqVjiSIYfxJl2SZRySLjG9SR0';

interface VideoPlayerProps {
  roomId: string;
  userId: string;
}

interface VideoState {
  isPlaying: boolean;
  timestamp: number;
  currentTime: number;
  videoId: string;
}

const VideoPlayer = ({ roomId, userId }: VideoPlayerProps) => {
  const { user } = useAuth();
  const playerRef = useRef<YT.Player | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoId, setVideoId] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const syncIntervalRef = useRef<number | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const apiLoadedRef = useRef(false);
  const pendingVideoIdRef = useRef<string | null>(null);
  const remoteUpdateRef = useRef(false);
  const lastSyncTimeRef = useRef(0);
  const [showEmptyState, setShowEmptyState] = useState(false);

  useEffect(() => {
    const loadYouTubeAPI = () => {
      if (!window.YT && !apiLoadedRef.current) {
        apiLoadedRef.current = true;
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }

        window.onYouTubeIframeAPIReady = () => {
          console.log('YouTube API is ready');
          if (pendingVideoIdRef.current) {
            createPlayer(pendingVideoIdRef.current);
          }
        };
      } else if (window.YT && window.YT.Player && pendingVideoIdRef.current) {
        createPlayer(pendingVideoIdRef.current);
      }
    };
    
    loadYouTubeAPI();

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    if (videoId) {
      console.log('Video ID changed to:', videoId);
      pendingVideoIdRef.current = videoId;
      setShowEmptyState(false);
      
      if (window.YT && window.YT.Player) {
        if (playerRef.current) {
          console.log('Loading video into existing player:', videoId);
          playerRef.current.loadVideoById(videoId);
          
          if (playerRef.current.getIframe()) {
            playerRef.current.getIframe().allow = "autoplay; fullscreen; picture-in-picture";
          }
        } else {
          console.log('Creating new player with video:', videoId);
          createPlayer(videoId);
        }
      } else {
        console.log('YouTube API not ready, video ID will be loaded when ready');
      }
    }
  }, [videoId]);

  useEffect(() => {
    const roomSubscription = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'video_rooms',
        filter: `id=eq.${roomId}`,
      }, (payload: any) => {
        const videoState = payload.new?.video_state as VideoState | undefined;
        if (videoState) {
          handleRemoteStateChange(videoState);
        }
      })
      .subscribe();

    fetchRoomState();

    syncIntervalRef.current = window.setInterval(() => {
      try {
        if (playerRef.current && isPlayerReady) {
          const now = Date.now();
          if (now - lastSyncTimeRef.current > 3000) {
            lastSyncTimeRef.current = now;
            const currentPlayerTime = playerRef.current.getCurrentTime();
            setCurrentTime(currentPlayerTime);
          
            if (isPlaying && !remoteUpdateRef.current) {
              updateRoomState(true, currentPlayerTime);
            }
          }
        }
      } catch (error) {
        console.error('Error in sync interval:', error);
      }
    }, 1000);

    return () => {
      roomSubscription.unsubscribe();
      if (syncIntervalRef.current) {
        window.clearInterval(syncIntervalRef.current);
      }
    };
  }, [roomId, isPlaying, isPlayerReady]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const fetchRoomState = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('video_rooms')
        .select('*')
        .eq('id', roomId)
        .single();

      if (error) throw error;

      if (data && data.video_state) {
        const videoState = data.video_state as VideoState;
        if (videoState.videoId) {
          console.log('Fetched video ID from room state:', videoState.videoId);
          setVideoId(videoState.videoId);
          setIsPlaying(videoState.isPlaying);
          if (videoState.currentTime > 0) {
            setCurrentTime(videoState.currentTime);
          }
        } else {
          setShowEmptyState(true);
        }
      } else {
        setShowEmptyState(true);
      }
    } catch (error) {
      console.error('Error fetching room state:', error);
      toast({
        title: 'Error',
        description: 'Failed to load room state',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoteStateChange = (videoState: VideoState) => {
    console.log('Remote state change:', videoState);
    remoteUpdateRef.current = true;
    
    try {
      if (videoState.videoId && videoState.videoId !== videoId) {
        console.log(`Setting video from remote update: ${videoState.videoId}`);
        setVideoId(videoState.videoId);
        setShowEmptyState(false);
      }

      if (videoState.isPlaying !== isPlaying) {
        setIsPlaying(videoState.isPlaying);
        if (playerRef.current && isPlayerReady && videoState.videoId === videoId) {
          if (videoState.isPlaying) {
            playerRef.current.playVideo();
          } else {
            playerRef.current.pauseVideo();
          }
        }
      }

      if (playerRef.current && isPlayerReady && videoState.videoId === videoId && videoState.currentTime !== undefined) {
        const currentPlayerTime = playerRef.current.getCurrentTime();
        const timeDiff = Math.abs(currentPlayerTime - videoState.currentTime);
        
        if (timeDiff > 3) {
          console.log(`Syncing time: ${videoState.currentTime}s (diff: ${timeDiff}s)`);
          playerRef.current.seekTo(videoState.currentTime, true);
        }
      }
    } catch (error) {
      console.error('Error handling remote state change:', error);
    } finally {
      setTimeout(() => {
        remoteUpdateRef.current = false;
      }, 1000);
    }
  };

  const createPlayer = (initialVideoId: string) => {
    console.log('Creating player with videoId:', initialVideoId);
    if (!initialVideoId || !window.YT || !window.YT.Player) {
      console.log('Cannot create player: missing videoId or YT API');
      return;
    }
    
    try {
      if (playerRef.current) {
        console.log('Destroying existing player');
        playerRef.current.destroy();
        playerRef.current = null;
      }
      
      if (!playerContainerRef.current) {
        console.error('YouTube player container not found');
        return;
      }
      
      while (playerContainerRef.current.firstChild) {
        playerContainerRef.current.removeChild(playerContainerRef.current.firstChild);
      }
      
      const playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-player';
      playerContainerRef.current.appendChild(playerDiv);
      
      console.log('Initializing YouTube player with video ID:', initialVideoId);
      playerRef.current = new window.YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: initialVideoId,
        playerVars: {
          playsinline: 1,
          modestbranding: 1,
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (event) => {
            onPlayerReady(event);
            const iframe = event.target.getIframe();
            if (iframe) {
              iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
            }
          },
          onStateChange: onPlayerStateChange,
          onError: (event) => {
            console.error('YouTube player error:', event.data);
            setIsLoading(false);
            toast({
              title: 'Error',
              description: 'Failed to load video. Please try another one.',
              variant: 'destructive'
            });
          }
        },
      });
    } catch (error) {
      console.error('Error creating YouTube player:', error);
      setIsLoading(false);
    }
  };

  const onPlayerReady = (event: YT.PlayerEvent) => {
    console.log('Player is ready');
    setIsPlayerReady(true);
    setIsLoading(false);
    
    try {
      const videoData = event.target.getVideoData();
      console.log('Current video data:', videoData);
      
      if (currentTime > 0) {
        console.log(`Seeking to saved time: ${currentTime}s`);
        event.target.seekTo(currentTime, true);
      }
      
      if (isPlaying) {
        event.target.playVideo();
      }
    } catch (error) {
      console.error('Error getting video data:', error);
    }
  };

  const onPlayerStateChange = (event: YT.PlayerEvent) => {
    console.log('Player state changed:', event.data);
    
    if (!remoteUpdateRef.current) {
      if (event.data === window.YT?.PlayerState.PLAYING) {
        setIsPlaying(true);
        
        try {
          const currentPlayerTime = event.target.getCurrentTime();
          updateRoomState(true, currentPlayerTime);
        } catch (error) {
          console.error('Error getting current time:', error);
        }
      } else if (event.data === window.YT?.PlayerState.PAUSED) {
        setIsPlaying(false);
        
        try {
          const currentPlayerTime = event.target.getCurrentTime();
          updateRoomState(false, currentPlayerTime);
        } catch (error) {
          console.error('Error getting current time:', error);
        }
      }
    }
  };

  const updateRoomState = async (playing: boolean, time?: number) => {
    try {
      if (!playerRef.current) return;
      
      let currentPlayerTime = time;
      if (currentPlayerTime === undefined) {
        try {
          currentPlayerTime = playerRef.current.getCurrentTime();
        } catch (error) {
          console.error('Error getting current time:', error);
          currentPlayerTime = currentTime;
        }
      }
      
      await supabase
        .from('video_rooms')
        .update({
          video_state: {
            isPlaying: playing,
            timestamp: Date.now(),
            currentTime: Math.floor(currentPlayerTime),
            videoId
          }
        })
        .eq('id', roomId);
    } catch (error) {
      console.error('Error updating room state:', error);
    }
  };

  const togglePlayPause = () => {
    if (!playerRef.current || !isPlayerReady) return;
    
    try {
      if (isPlaying) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
    }
  };

  const skipForward = () => {
    if (!playerRef.current || !isPlayerReady) return;
    
    try {
      const currentPlayerTime = playerRef.current.getCurrentTime();
      const newTime = currentPlayerTime + 10;
      playerRef.current.seekTo(newTime, true);
      
      updateRoomState(isPlaying, newTime);
    } catch (error) {
      console.error('Error skipping forward:', error);
    }
  };

  const skipBackward = () => {
    if (!playerRef.current || !isPlayerReady) return;
    
    try {
      const currentPlayerTime = playerRef.current.getCurrentTime();
      const newTime = Math.max(0, currentPlayerTime - 10);
      playerRef.current.seekTo(newTime, true);
      
      updateRoomState(isPlaying, newTime);
    } catch (error) {
      console.error('Error skipping backward:', error);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const extractVideoId = (url: string): string | null => {
    const standardMatch = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (standardMatch) return standardMatch[1];
    
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    
    return null;
  };

  const handleSearch = async () => {
    if (!urlInput.trim()) {
      toast({
        title: 'Empty Search',
        description: 'Please enter a search term or YouTube URL',
        variant: 'destructive'
      });
      return;
    }

    const videoId = extractVideoId(urlInput);
    
    if (videoId) {
      changeVideo(videoId);
      return;
    }
    
    try {
      setIsSearching(true);
      setSearchResults([]);
      
      const storedKey = userId ? localStorage.getItem(`youtube_api_key_${userId}`) : null;
      const apiKey = storedKey || DEFAULT_YOUTUBE_API_KEY;
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(urlInput)}&type=video&key=${apiKey}`
      );
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      if (!data.items || data.items.length === 0) {
        toast({
          title: 'No results',
          description: 'No videos found for your search',
          variant: 'destructive',
        });
        return;
      }

      const results = data.items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url
      }));
      
      setSearchResults(results);
      
    } catch (error) {
      console.error('Error searching videos:', error);
      fallbackSearchFromYouTube();
    } finally {
      setIsSearching(false);
    }
  };

  const fallbackSearchFromYouTube = async () => {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(urlInput)}`;
      const response = await fetch(searchUrl);
      const html = await response.text();
      
      const videoPattern = /\/watch\?v=([\w-]{11})/g;
      const matches = html.matchAll(videoPattern);
      const uniqueIds = [...new Set([...matches].map(match => match[1]))].slice(0, 5);
      
      const results = await Promise.all(uniqueIds.map(async (id) => {
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${id}&format=json`);
          const data = await response.json();
          return {
            id,
            url: `https://www.youtube.com/watch?v=${id}`,
            title: data.title || 'Untitled Video'
          };
        } catch (error) {
          return {
            id,
            url: `https://www.youtube.com/watch?v=${id}`,
            title: 'Untitled Video'
          };
        }
      }));
      
      setSearchResults(results);
      
      if (results.length === 0) {
        toast({
          title: 'No Results',
          description: 'No videos found for your search query',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error in fallback search:', error);
      toast({
        title: 'Error',
        description: 'Failed to search videos',
        variant: 'destructive'
      });
    }
  };

  const loadSearchResult = (result: { id: string; title: string }) => {
    changeVideo(result.id);
    setSearchResults([]);
  };

  const changeVideo = async (newVideoId: string) => {
    try {
      console.log('Changing video to:', newVideoId);
      setVideoId(newVideoId);
      
      await supabase
        .from('video_rooms')
        .update({
          video_state: {
            isPlaying: false,
            timestamp: Date.now(),
            currentTime: 0,
            videoId: newVideoId
          }
        })
        .eq('id', roomId);
        
      setUrlInput('');
      
      toast({
        title: 'Video Changed',
        description: 'New video has been loaded',
      });
    } catch (error) {
      console.error('Error changing video:', error);
      toast({
        title: 'Error',
        description: 'Failed to change video',
        variant: 'destructive'
      });
    }
  };

  const shareRoom = () => {
    const shareUrl = `${window.location.origin}/room/${roomId}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Join my WatchTube room',
        text: 'Watch YouTube videos together!',
        url: shareUrl,
      }).catch(error => {
        console.error('Error sharing:', error);
        copyToClipboard(shareUrl);
      });
    } else {
      copyToClipboard(shareUrl);
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({
        title: 'Room link copied',
        description: 'Share this link with friends to invite them',
      });
    }).catch(err => {
      console.error('Failed to copy: ', err);
      toast({
        title: 'Failed to copy',
        description: 'Please manually copy the URL from your browser',
        variant: 'destructive'
      });
    });
  };

  return (
    <GlassCard className="p-0 overflow-hidden" ref={containerRef}>
      <div className="relative w-full aspect-video">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <LoadingSpinner size="lg" />
          </div>
        )}
        
        {showEmptyState && !isLoading && !videoId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10 p-6 text-center">
            <div className="rounded-full bg-primary/20 p-4 mb-4">
              <Play size={40} className="text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Add a video to start the party!</h3>
            <p className="text-muted-foreground mb-4">
              Search for a YouTube video or paste a URL in the search box below.
            </p>
          </div>
        )}
        
        <div 
          ref={playerContainerRef}
          className="w-full h-full bg-black"
        />
      </div>
      
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-2">
            <CustomButton
              size="icon"
              variant="ghost"
              onClick={skipBackward}
              disabled={!isPlayerReady || !videoId}
              title="Skip back 10 seconds"
            >
              <SkipBack size={20} />
            </CustomButton>
            
            <CustomButton
              size="icon"
              variant="ghost"
              onClick={togglePlayPause}
              disabled={!isPlayerReady || !videoId}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </CustomButton>
            
            <CustomButton
              size="icon"
              variant="ghost"
              onClick={skipForward}
              disabled={!isPlayerReady || !videoId}
              title="Skip forward 10 seconds"
            >
              <SkipForward size={20} />
            </CustomButton>
            
            <CustomButton
              size="icon"
              variant="ghost"
              onClick={toggleFullscreen}
              disabled={!videoId}
            >
              <Maximize2 size={20} />
            </CustomButton>
            
            <CustomButton
              size="icon"
              variant="ghost"
              onClick={shareRoom}
              title="Share room"
            >
              <Share2 size={20} />
            </CustomButton>
          </div>
          
          <div className="flex-1 max-w-md">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="YouTube URL or search term"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="h-10 bg-white/5 border-white/10"
              />
              <CustomButton
                variant="glow"
                size="sm"
                onClick={handleSearch}
                isLoading={isSearching}
                icon={<Link2 size={16} />}
              >
                Search
              </CustomButton>
            </div>
          </div>
        </div>
        
        {searchResults.length > 0 && (
          <div className="bg-black/30 backdrop-blur-sm rounded-md p-3 max-h-60 overflow-y-auto">
            <h3 className="text-sm font-medium mb-2">Search Results</h3>
            <div className="space-y-2">
              {searchResults.map((result) => (
                <div 
                  key={result.id}
                  onClick={() => loadSearchResult(result)}
                  className="flex items-center gap-2 p-2 hover:bg-white/10 rounded-md cursor-pointer transition-colors"
                >
                  <img 
                    src={result.thumbnail}
                    alt={result.title}
                    className="w-16 h-12 object-cover rounded"
                  />
                  <div className="flex-1 truncate">
                    <p className="text-sm font-medium truncate">{result.title}</p>
                  </div>
                  <Play size={16} className="text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
};

export default VideoPlayer;
