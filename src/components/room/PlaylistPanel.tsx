
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Save, Trash2, ListPlus, MoveUp, MoveDown, Search, X, Play } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PlaylistItem, { PlaylistItemType } from './PlaylistItem';
import SaveToPlaylistModal from './SaveToPlaylistModal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

interface PlaylistPanelProps {
  roomId: string;
  currentVideoId: string;
  onPlayVideo: (videoId: string) => void;
}

interface SearchResult {
  id: string;
  title: string;
}

const PlaylistPanel = ({ roomId, currentVideoId, onPlayVideo }: PlaylistPanelProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [playlistItems, setPlaylistItems] = useState<PlaylistItemType[]>([]);
  const [filteredItems, setFilteredItems] = useState<PlaylistItemType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQueryLocal, setSearchQueryLocal] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (roomId) {
      fetchPlaylist();
    }
  }, [roomId]);

  useEffect(() => {
    if (searchQueryLocal.trim() === '') {
      setFilteredItems(playlistItems);
    } else {
      const filtered = playlistItems.filter(item => 
        item.title.toLowerCase().includes(searchQueryLocal.toLowerCase())
      );
      setFilteredItems(filtered);
    }
  }, [searchQueryLocal, playlistItems]);

  const fetchPlaylist = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('playlist_items')
        .select('*')
        .eq('room_id', roomId)
        .order('position', { ascending: true });
        
      if (error) throw error;
      
      setPlaylistItems(data || []);
      setFilteredItems(data || []); // Initialize filtered items with all items
    } catch (error) {
      console.error('Error fetching playlist:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const removeItem = async (id: string) => {
    try {
      const { error } = await supabase
        .from('playlist_items')
        .delete()
        .eq('id', id);
        
      if (error) throw error;
      
      setPlaylistItems(playlistItems.filter(item => item.id !== id));
      
      toast({
        title: 'Removed',
        description: 'Video removed from playlist',
      });
    } catch (error) {
      console.error('Error removing playlist item:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove video',
        variant: 'destructive'
      });
    }
  };

  const moveItem = async (id: string, direction: 'up' | 'down') => {
    const currentIndex = playlistItems.findIndex(item => item.id === id);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' 
      ? Math.max(0, currentIndex - 1)
      : Math.min(playlistItems.length - 1, currentIndex + 1);
      
    if (newIndex === currentIndex) return;
    
    const itemToMove = playlistItems[currentIndex];
    const displacedItem = playlistItems[newIndex];
    
    try {
      const updatedPlaylist = [...playlistItems];
      updatedPlaylist[currentIndex] = { ...displacedItem };
      updatedPlaylist[newIndex] = { ...itemToMove };
      
      // Update the positions
      updatedPlaylist[currentIndex].position = currentIndex;
      updatedPlaylist[newIndex].position = newIndex;
      
      setPlaylistItems(updatedPlaylist);
      
      // Update in database
      const updates = [
        { id: itemToMove.id, position: newIndex },
        { id: displacedItem.id, position: currentIndex }
      ];
      
      for (const update of updates) {
        await supabase
          .from('playlist_items')
          .update({ position: update.position })
          .eq('id', update.id);
      }
    } catch (error) {
      console.error('Error moving playlist item:', error);
      fetchPlaylist(); // Refresh on error
      toast({
        title: 'Error',
        description: 'Failed to reorder playlist',
        variant: 'destructive'
      });
    }
  };

  const searchYouTube = async () => {
    if (!searchQueryLocal.trim()) return;
    
    setIsSearching(true);
    try {
      // Using the YouTube search method
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQueryLocal)}`;
      const response = await fetch(searchUrl);
      const html = await response.text();

      // Extract video IDs from search results
      const videoPattern = /\/watch\?v=([\w-]{11})/g;
      const matches = html.matchAll(videoPattern);
      const uniqueIds = [...new Set([...matches].map(match => match[1]))].slice(0, 5);

      // Get video titles
      const results = await Promise.all(uniqueIds.map(async id => {
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
      toast({
        title: 'Search Complete',
        description: `Found ${results.length} videos`
      });
    } catch (error) {
      console.error('Error searching YouTube:', error);
      toast({
        title: 'Search Failed',
        description: 'Unable to search YouTube videos',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addVideoToPlaylist = async (videoId: string, title: string) => {
    try {
      // Get current max position
      const { data: playlistData } = await supabase
        .from('playlist_items')
        .select('position')
        .eq('room_id', roomId)
        .order('position', { ascending: false })
        .limit(1);
      
      const nextPosition = (playlistData?.[0]?.position ?? -1) + 1;
      
      const { error } = await supabase
        .from('playlist_items')
        .insert({
          room_id: roomId,
          video_id: videoId,
          title,
          position: nextPosition,
          added_by: user?.id || ''
        });
        
      if (error) throw error;
      
      toast({
        title: 'Added to Playlist',
        description: `"${title}" has been added to the playlist`
      });
      
      // Refresh playlist
      fetchPlaylist();
      
      // Clear search results
      setSearchResults([]);
    } catch (error) {
      console.error('Error adding video to playlist:', error);
      toast({
        title: 'Error',
        description: 'Failed to add video to playlist',
        variant: 'destructive'
      });
    }
  };

  const saveAllToUserPlaylist = async (playlistId: string) => {
    if (!user || !playlistId || playlistItems.length === 0) return;
    
    setIsSaving(true);
    try {
      let successCount = 0;
      
      for (const item of playlistItems) {
        // Check if the video already exists in the playlist
        const { data: existingItems } = await supabase
          .from('user_playlist_items')
          .select('id')
          .eq('playlist_id', playlistId)
          .eq('video_id', item.video_id)
          .eq('user_id', user.id);
        
        if (existingItems && existingItems.length > 0) {
          continue; // Skip existing videos
        }

        // Get current max position
        const { data: currentItems } = await supabase
          .from('user_playlist_items')
          .select('position')
          .eq('playlist_id', playlistId)
          .order('position', { ascending: false })
          .limit(1);

        const nextPosition = (currentItems?.[0]?.position ?? -1) + 1;

        // Add video to playlist
        const { error } = await supabase
          .from('user_playlist_items')
          .insert({
            playlist_id: playlistId,
            user_id: user.id,
            video_id: item.video_id,
            title: item.title,
            position: nextPosition
          });

        if (!error) {
          successCount++;
        }
      }
      
      toast({
        title: 'Success',
        description: `Added ${successCount} videos to your playlist`,
      });
    } catch (error) {
      console.error('Error saving to user playlist:', error);
      toast({
        title: 'Error',
        description: 'Failed to save videos to playlist',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (showSearch) {
      setSearchResults([]);
      setSearchQueryLocal('');
    }
  };

  return (
    <GlassCard className={`h-full flex flex-col ${isMobile ? 'h-[calc(100vh-280px)]' : ''}`}>
      <div className="flex justify-between items-center px-4 py-3 border-b border-white/10">
        <h2 className="font-semibold">Room Playlist</h2>
        <div className="flex gap-2 items-center">
          <CustomButton
            size="icon"
            variant={showSearch ? "default" : "ghost"}
            onClick={toggleSearch}
            className="h-8 w-8"
            title={showSearch ? "Close Search" : "Search Videos"}
          >
            {showSearch ? <X size={16} /> : <Search size={16} />}
          </CustomButton>
          
          {user && playlistItems.length > 0 && (
            <CustomButton
              size="sm"
              variant="outline"
              onClick={() => setIsModalOpen(true)}
              className="text-xs"
            >
              <Save size={14} className="mr-1" />
              Save All
            </CustomButton>
          )}
        </div>
      </div>
      
      {showSearch && (
        <div className="p-3 border-b border-white/10 bg-background/30">
          <div className="flex gap-2 items-center">
            <Input
              value={searchQueryLocal}
              onChange={(e) => setSearchQueryLocal(e.target.value)}
              placeholder={searchResults.length ? "Filter playlist..." : "Search YouTube videos..."}
              className="h-9 bg-white/5 border-white/10"
              onKeyDown={(e) => e.key === 'Enter' && (searchResults.length ? null : searchYouTube())}
            />
            {!searchResults.length && (
              <CustomButton
                size="sm"
                variant="glow"
                onClick={searchYouTube}
                isLoading={isSearching}
                disabled={!searchQueryLocal.trim() || isSearching}
              >
                Search
              </CustomButton>
            )}
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-medium">Search Results</h3>
                <CustomButton
                  size="sm"
                  variant="outline"
                  onClick={() => setSearchResults([])}
                  className="text-xs h-7"
                >
                  Clear
                </CustomButton>
              </div>
              
              {searchResults.map(result => (
                <div key={result.id} className="bg-black/20 backdrop-blur-sm rounded-md p-2 flex items-center gap-2">
                  <img src={`https://i.ytimg.com/vi/${result.id}/default.jpg`} alt={result.title} className="w-16 h-12 object-cover rounded" />
                  <div className="flex-1 truncate">
                    <p className="text-sm font-medium truncate text-white">{result.title}</p>
                  </div>
                  <div className="flex gap-1">
                    <CustomButton
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-white hover:bg-white/10"
                      onClick={() => onPlayVideo(result.id)}
                      title="Play Now"
                    >
                      <Play size={16} className="fill-white/20" />
                    </CustomButton>
                    <CustomButton
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-white hover:bg-white/10"
                      onClick={() => addVideoToPlaylist(result.id, result.title)}
                      title="Add to Playlist"
                    >
                      <ListPlus size={16} />
                    </CustomButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      <div className={`flex-1 overflow-hidden ${isMobile ? 'overflow-y-auto' : ''}`}>
        {isMobile ? (
          <div className="h-full overflow-y-auto py-2 px-2">
            {renderPlaylistContent()}
          </div>
        ) : (
          <ScrollArea className="h-full py-2 px-2">
            {renderPlaylistContent()}
          </ScrollArea>
        )}
      </div>
      
      {isModalOpen && (
        <SaveToPlaylistModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={saveAllToUserPlaylist}
          videos={playlistItems}
        />
      )}
    </GlassCard>
  );
  
  function renderPlaylistContent() {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center h-full">
          <LoadingSpinner size="md" />
        </div>
      );
    }
    
    if (filteredItems.length === 0) {
      if (searchQueryLocal && playlistItems.length > 0) {
        return (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
            <p>No playlist items match your search</p>
          </div>
        );
      }
      
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
          <ListPlus size={40} className="opacity-20 mb-2" />
          <p>Playlist is empty</p>
          <p className="text-sm">Add videos to get started</p>
        </div>
      );
    }
    
    return (
      <div className="space-y-2">
        {filteredItems.map((item) => (
          <PlaylistItem 
            key={item.id}
            item={item}
            isPlaying={item.video_id === currentVideoId}
            onPlay={() => onPlayVideo(item.video_id)}
            onRemove={() => removeItem(item.id)}
            onMoveUp={() => moveItem(item.id, 'up')}
            onMoveDown={() => moveItem(item.id, 'down')}
          />
        ))}
      </div>
    );
  }
};

export default PlaylistPanel;
