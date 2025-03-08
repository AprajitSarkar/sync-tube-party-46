import React, { useState, useEffect } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { CustomButton } from '@/components/ui/custom-button';
import { Search, Plus, Play, Save } from 'lucide-react';
import { supabase, DEFAULT_YOUTUBE_API_KEY } from '@/lib/supabase';
import { DragDropContext, Droppable } from 'react-beautiful-dnd';
import PlaylistItem from './PlaylistItem';
import { toast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import LogToast from '@/components/common/LogToast';

interface PlaylistPanelProps {
  roomId: string;
  currentVideoId: string;
  onPlayVideo: (videoId: string) => void;
}

interface PlaylistItem {
  id: string;
  room_id: string;
  video_id: string;
  title: string;
  position: number;
}

const PlaylistPanel = ({ roomId, currentVideoId, onPlayVideo }: PlaylistPanelProps) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { user } = useAuth();
  const [showSaveOptions, setShowSaveOptions] = useState<{[key: string]: boolean}>({});
  const [userPlaylists, setUserPlaylists] = useState<any[]>([]);
  const [logMessage, setLogMessage] = useState('');
  const [logVisible, setLogVisible] = useState(false);

  useEffect(() => {
    fetchPlaylist();
    if (user) {
      fetchUserPlaylists();
    }

    const playlistSubscription = supabase
      .channel(`playlist:${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'playlist_items',
        filter: `room_id=eq.${roomId}`,
      }, () => {
        fetchPlaylist();
      })
      .subscribe();

    return () => {
      playlistSubscription.unsubscribe();
    };
  }, [roomId, user]);

  const showLog = (message: string) => {
    setLogMessage(message);
    setLogVisible(true);
  };

  const hideLog = () => {
    setLogVisible(false);
  };

  const fetchUserPlaylists = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', user.id);
        
      if (error) throw error;
      
      setUserPlaylists(data || []);
    } catch (error) {
      console.error('Error fetching user playlists:', error);
    }
  };

  const fetchPlaylist = async () => {
    try {
      setIsLoading(true);
      showLog("Loading playlist...");
      
      const { data, error } = await supabase
        .from('playlist_items')
        .select('*')
        .eq('room_id', roomId)
        .order('position', { ascending: true });

      if (error) throw error;
      setPlaylist(data || []);
      showLog("Playlist loaded");
    } catch (error) {
      console.error('Error fetching playlist:', error);
      showLog("Failed to load playlist");
      toast({
        title: 'Error',
        description: 'Failed to load playlist',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const extractVideoId = (url: string): string | null => {
    const standardMatch = url.match(/(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (standardMatch) return standardMatch[1];
    
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    
    return null;
  };

  const addToPlaylist = async () => {
    if (!urlInput.includes('youtube.com') && !urlInput.includes('youtu.be') && !/^[a-zA-Z0-9_-]{11}$/.test(urlInput)) {
      handleSearch(urlInput);
      return;
    }

    const videoId = extractVideoId(urlInput);
    
    if (!videoId) {
      toast({
        title: 'Invalid URL',
        description: 'Please enter a valid YouTube URL or video ID',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      showLog("Adding to playlist...");
      const response = await fetch(`https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=${videoId}&format=json`);
      const data = await response.json();
      const title = data.title || 'Untitled Video';
      
      const maxPosition = playlist.length > 0 
        ? Math.max(...playlist.map(item => item.position)) 
        : -1;
      
      const { error } = await supabase
        .from('playlist_items')
        .insert({
          room_id: roomId,
          video_id: videoId,
          title,
          position: maxPosition + 1,
          added_by: user?.id
        });

      if (error) {
        console.error('Error adding to playlist:', error);
        throw error;
      }
      
      setUrlInput('');
      showLog("Added to playlist");
      toast({
        title: 'Video Added',
        description: `"${title}" added to playlist`,
      });
    } catch (error) {
      console.error('Error adding to playlist:', error);
      showLog("Failed to add to playlist");
      toast({
        title: 'Error',
        description: 'Failed to add video to playlist. Please try again.',
        variant: 'destructive'
      });
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      toast({
        title: 'Empty Search',
        description: 'Please enter a search term',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      setIsSearching(true);
      showLog("Searching videos...");
      
      const userId = user?.id;
      const storedKey = userId ? localStorage.getItem(`youtube_api_key_${userId}`) : null;
      const apiKey = storedKey || DEFAULT_YOUTUBE_API_KEY;
      
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`);
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      const results = data.items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.default.url
      }));
      
      setSearchResults(results);
      showLog(`Found ${results.length} videos`);
      
      if (results.length === 0) {
        toast({
          title: 'No Results',
          description: 'No videos found for your search',
          variant: 'destructive'
        });
      }
    } catch (error: any) {
      console.error('Error searching videos:', error);
      showLog("Search failed");
      
      fallbackSearch(query);
    } finally {
      setIsSearching(false);
    }
  };

  const fallbackSearch = async (query: string) => {
    if (!query.trim()) {
      toast({
        title: 'Empty Search',
        description: 'Please enter a search term',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      setIsSearching(true);
      showLog("Searching videos...");
      
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
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
            title: data.title || 'Untitled Video'
          };
        } catch (error) {
          return {
            id,
            title: 'Untitled Video'
          };
        }
      }));
      
      setSearchResults(results);
      showLog(`Found ${results.length} videos`);
      
      if (results.length === 0) {
        toast({
          title: 'No Results',
          description: 'No videos found for your search',
          variant: 'destructive'
        });
      }
    } catch (error) {
      console.error('Error searching videos:', error);
      showLog("Search failed");
      toast({
        title: 'Error',
        description: 'Failed to search videos',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addSearchResultToPlaylist = async (result: any) => {
    try {
      showLog("Adding to playlist...");
      const maxPosition = playlist.length > 0 
        ? Math.max(...playlist.map(item => item.position)) 
        : -1;
      
      const { error } = await supabase
        .from('playlist_items')
        .insert({
          room_id: roomId,
          video_id: result.id,
          title: result.title,
          position: maxPosition + 1,
          added_by: user?.id
        });

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }
      
      setSearchResults([]);
      setUrlInput('');
      showLog("Added to playlist");
      toast({
        title: 'Video Added',
        description: `"${result.title}" added to playlist`,
      });
    } catch (error) {
      console.error('Error adding to playlist:', error);
      showLog("Failed to add to playlist");
      toast({
        title: 'Error',
        description: 'Failed to add video to playlist',
        variant: 'destructive'
      });
    }
  };

  const saveToUserPlaylist = async (videoId: string, title: string, playlist: any) => {
    if (!user) return;
    
    try {
      showLog(`Saving to "${playlist.name}"...`);
      
      const { data: playlistCheck, error: checkError } = await supabase
        .from('user_playlists')
        .select('id')
        .eq('id', playlist.id)
        .single();
        
      if (checkError) {
        console.error('Error checking playlist existence:', checkError);
        throw new Error('Playlist not found');
      }
      
      const { data: positionData, error: positionError } = await supabase
        .from('user_playlist_items')
        .select('position')
        .eq('user_id', user.id)
        .eq('playlist_id', playlist.id)
        .order('position', { ascending: false })
        .limit(1);
        
      if (positionError) throw positionError;
      
      const maxPosition = positionData && positionData.length > 0 ? positionData[0].position : -1;
      
      const { error } = await supabase
        .from('user_playlist_items')
        .insert({
          user_id: user.id,
          playlist_id: playlist.id,
          video_id: videoId,
          title,
          position: maxPosition + 1
        });
        
      if (error) throw error;
      
      toggleSaveOptions(videoId);
      
      showLog("Saved to playlist");
      toast({
        title: 'Success',
        description: `Saved to "${playlist.name}" playlist`,
      });
    } catch (error) {
      console.error('Error saving to user playlist:', error);
      showLog("Failed to save to playlist");
      toast({
        title: 'Error',
        description: 'Failed to save to your playlist',
        variant: 'destructive'
      });
    }
  };

  const toggleSaveOptions = (videoId: string) => {
    setShowSaveOptions(prev => ({
      ...prev,
      [videoId]: !prev[videoId]
    }));
  };

  const removeFromPlaylist = async (id: string) => {
    try {
      showLog("Removing from playlist...");
      const { error } = await supabase
        .from('playlist_items')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      const updatedPlaylist = playlist.filter(item => item.id !== id);
      updatePositions(updatedPlaylist);
      
      showLog("Removed from playlist");
      toast({
        title: 'Video Removed',
        description: 'Video removed from playlist',
      });
    } catch (error) {
      console.error('Error removing from playlist:', error);
      showLog("Failed to remove from playlist");
      toast({
        title: 'Error',
        description: 'Failed to remove video from playlist',
        variant: 'destructive'
      });
    }
  };

  const handleDragEnd = async (result: any) => {
    if (!result.destination) return;
    
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    
    if (sourceIndex === destinationIndex) return;
    
    const newPlaylist = [...playlist];
    const [removed] = newPlaylist.splice(sourceIndex, 1);
    newPlaylist.splice(destinationIndex, 0, removed);
    
    updatePositions(newPlaylist);
  };

  const updatePositions = async (newPlaylist: PlaylistItem[]) => {
    setPlaylist(newPlaylist);
    
    try {
      showLog("Updating playlist order...");
      const updates = newPlaylist.map((item, index) => ({
        id: item.id,
        position: index,
      }));
      
      for (const update of updates) {
        await supabase
          .from('playlist_items')
          .update({ position: update.position })
          .eq('id', update.id);
      }
      showLog("Playlist order updated");
    } catch (error) {
      console.error('Error updating positions:', error);
      showLog("Failed to update playlist order");
      toast({
        title: 'Error',
        description: 'Failed to update playlist order',
        variant: 'destructive'
      });
      
      fetchPlaylist();
    }
  };

  const createNewPlaylist = async (videoId: string, title: string, newPlaylistName: string) => {
    if (!user || !newPlaylistName.trim()) return;
    
    try {
      showLog("Creating new playlist...");
      
      const { data, error: playlistError } = await supabase
        .from('user_playlists')
        .insert({
          user_id: user.id,
          name: newPlaylistName.trim()
        })
        .select()
        .single();
        
      if (playlistError) throw playlistError;
      
      // Now add the video to the new playlist
      const { error: itemError } = await supabase
        .from('user_playlist_items')
        .insert({
          user_id: user.id,
          playlist_id: data.id,
          video_id: videoId,
          title,
          position: 0
        });
        
      if (itemError) throw itemError;
      
      // Update the local playlists state
      setUserPlaylists(prev => [...prev, data]);
      
      toggleSaveOptions(videoId);
      
      showLog("Created and saved to new playlist");
      toast({
        title: 'Success',
        description: `Created "${newPlaylistName}" and saved video`,
      });
    } catch (error) {
      console.error('Error creating new playlist:', error);
      showLog("Failed to create playlist");
      toast({
        title: 'Error',
        description: 'Failed to create new playlist',
        variant: 'destructive'
      });
    }
  };

  return (
    <>
      <LogToast 
        message={logMessage} 
        visible={logVisible} 
        onHide={hideLog} 
        duration={1000}
      />
      
      <GlassCard className="flex flex-col h-full">
        <div className="p-3 border-b border-white/10">
          <h3 className="font-medium text-white">Playlist</h3>
        </div>
        
        <div className="p-3 border-b border-white/10">
          <div className="flex gap-2">
            <Input
              placeholder="YouTube URL or search..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="h-10 bg-background/30 border-white/20 text-white"
            />
            <CustomButton
              size="sm"
              variant="glow"
              onClick={addToPlaylist}
              isLoading={isSearching}
              icon={urlInput.includes('youtube.com') || urlInput.includes('youtu.be') ? <Plus size={16} /> : <Search size={16} />}
            >
              {urlInput.includes('youtube.com') || urlInput.includes('youtu.be') ? 'Add' : 'Search'}
            </CustomButton>
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-3">
              <GlassCard className="p-2" intensity="light">
                <h4 className="text-sm font-medium mb-2 text-white">Search Results</h4>
                <div className="space-y-2">
                  {searchResults.map((result) => (
                    <div 
                      key={result.id} 
                      className="flex items-center p-2 hover:bg-white/10 rounded cursor-pointer"
                    >
                      <div className="w-12 h-9 bg-black/40 rounded overflow-hidden flex-shrink-0 mr-2">
                        <img 
                          src={`https://i.ytimg.com/vi/${result.id}/default.jpg`} 
                          alt={result.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.src = 'public/placeholder.svg';
                          }}
                        />
                      </div>
                      <p className="text-sm truncate flex-1 text-white">{result.title}</p>
                      <div className="flex gap-1">
                        <button 
                          className="p-2 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                          onClick={() => onPlayVideo(result.id)}
                          title="Play now"
                        >
                          <Play size={16} className="text-white fill-white/20" />
                        </button>
                        <button 
                          className="p-2 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                          onClick={() => {
                            addSearchResultToPlaylist(result);
                          }}
                          title="Add to room playlist"
                        >
                          <Plus size={16} className="text-white" />
                        </button>
                        {user && (
                          <div className="relative">
                            <button 
                              className="p-2 rounded-full hover:bg-white/10 transition flex items-center justify-center"
                              onClick={() => toggleSaveOptions(result.id)}
                              title="Save to your playlist"
                            >
                              <Save size={16} className="text-white" />
                            </button>
                            
                            {showSaveOptions[result.id] && (
                              <div className="absolute right-0 mt-1 z-20 bg-black/80 backdrop-blur-md rounded-md shadow-lg border border-white/10 w-48">
                                <div className="p-2 border-b border-white/10">
                                  <p className="text-xs font-medium">Save to playlist</p>
                                </div>
                                <div className="max-h-40 overflow-y-auto p-1">
                                  {userPlaylists.length > 0 ? (
                                    userPlaylists.map(name => (
                                      <button
                                        key={name}
                                        className="w-full text-left p-2 text-sm hover:bg-white/10 rounded-sm"
                                        onClick={() => saveToUserPlaylist(result.id, result.title, name)}
                                      >
                                        {name}
                                      </button>
                                    ))
                                  ) : (
                                    <p className="text-xs p-2 text-muted-foreground">No playlists yet</p>
                                  )}
                                </div>
                                <div className="p-2 border-t border-white/10">
                                  <div className="flex gap-1">
                                    <Input
                                      placeholder="New playlist..."
                                      className="h-7 text-xs"
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const input = e.currentTarget;
                                          createNewPlaylist(result.id, result.title, input.value);
                                          input.value = '';
                                        }
                                      }}
                                    />
                                    <CustomButton
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const input = e.currentTarget.previousSibling as HTMLInputElement;
                                        createNewPlaylist(result.id, result.title, input.value);
                                        input.value = '';
                                      }}
                                    >
                                      <Plus size={14} />
                                    </CustomButton>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              {playlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-white">
                  <p>Playlist is empty</p>
                  <p className="text-sm mt-1 text-white/70">Add videos using the search box above</p>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="playlist">
                    {(provided) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                      >
                        {playlist.map((item, index) => (
                          <div key={item.id} className="relative">
                            <PlaylistItem
                              videoItem={{
                                id: item.id,
                                title: item.title,
                                videoId: item.video_id,
                              }}
                              index={index}
                              isPlaying={item.video_id === currentVideoId}
                              onPlay={() => onPlayVideo(item.video_id)}
                              onRemove={removeFromPlaylist}
                            />
                            
                            {user && (
                              <>
                                <button
                                  className="absolute right-14 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-white/10"
                                  onClick={() => toggleSaveOptions(item.video_id)}
                                  title="Save to your playlist"
                                >
                                  <Save size={14} className="text-white" />
                                </button>
                                
                                {showSaveOptions[item.video_id] && (
                                  <div className="absolute right-14 top-full mt-1 z-20 bg-black/80 backdrop-blur-md rounded-md shadow-lg border border-white/10 w-48">
                                    <div className="p-2 border-b border-white/10">
                                      <p className="text-xs font-medium">Save to playlist</p>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto p-1">
                                      {userPlaylists.length > 0 ? (
                                        userPlaylists.map(name => (
                                          <button
                                            key={name}
                                            className="w-full text-left p-2 text-sm hover:bg-white/10 rounded-sm"
                                            onClick={() => saveToUserPlaylist(item.video_id, item.title, name)}
                                          >
                                            {name}
                                          </button>
                                        ))
                                      ) : (
                                        <p className="text-xs p-2 text-muted-foreground">No playlists yet</p>
                                      )}
                                    </div>
                                    <div className="p-2 border-t border-white/10">
                                      <div className="flex gap-1">
                                        <Input
                                          placeholder="New playlist..."
                                          className="h-7 text-xs"
                                          onClick={(e) => e.stopPropagation()}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              const input = e.currentTarget;
                                              createNewPlaylist(item.video_id, item.title, input.value);
                                              input.value = '';
                                            }
                                          }}
                                        />
                                        <CustomButton
                                          size="icon"
                                          variant="ghost"
                                          className="h-7 w-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const input = e.currentTarget.previousSibling as HTMLInputElement;
                                            createNewPlaylist(item.video_id, item.title, input.value);
                                            input.value = '';
                                          }}
                                        >
                                          <Plus size={14} />
                                        </CustomButton>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          </ScrollArea>
        </div>
      </GlassCard>
    </>
  );
};

export default PlaylistPanel;
