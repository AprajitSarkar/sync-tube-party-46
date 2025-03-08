
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { CustomButton } from '@/components/ui/custom-button';
import { Plus, Search, ExternalLink, Play, ListPlus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase, DEFAULT_YOUTUBE_API_KEY } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import LoadingSpinner from '@/components/common/LoadingSpinner';

interface PlaylistEditorProps {
  playlistId: string;
  onVideoAdded: () => void;
}

interface SearchResult {
  id: string;
  title: string;
}

const PlaylistEditor = ({ playlistId, onVideoAdded }: PlaylistEditorProps) => {
  const { user } = useAuth();
  const [videoUrl, setVideoUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const extractVideoId = (url: string) => {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const addVideoToPlaylist = async (videoId: string) => {
    try {
      // Use the stored API key from local storage or fall back to the default key
      const storedKey = user?.id ? localStorage.getItem(`youtube_api_key_${user.id}`) : null;
      const apiKey = storedKey || DEFAULT_YOUTUBE_API_KEY;
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
      );
      
      const data = await response.json();

      if (!data.items?.[0]) {
        toast({
          title: 'Error',
          description: 'Video not found',
          variant: 'destructive',
        });
        return;
      }

      const videoTitle = data.items[0].snippet.title;

      // Get current position
      const { data: currentItems } = await supabase
        .from('user_playlist_items')
        .select('position')
        .eq('playlist_id', playlistId)
        .order('position', { ascending: false })
        .limit(1);

      const nextPosition = (currentItems?.[0]?.position ?? -1) + 1;

      const { error } = await supabase
        .from('user_playlist_items')
        .insert({
          playlist_id: playlistId,
          user_id: user?.id,
          video_id: videoId,
          title: videoTitle,
          position: nextPosition
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Video added to playlist',
      });

      setVideoUrl('');
      setSearchQuery('');
      onVideoAdded();
    } catch (error) {
      console.error('Error adding video:', error);
      toast({
        title: 'Error',
        description: 'Failed to add video',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddVideo = async () => {
    if (!videoUrl.trim()) return;
    
    setIsAdding(true);
    const videoId = extractVideoId(videoUrl);
    
    if (!videoId) {
      toast({
        title: 'Error',
        description: 'Invalid YouTube URL',
        variant: 'destructive',
      });
      setIsAdding(false);
      return;
    }

    await addVideoToPlaylist(videoId);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      setIsSearching(true);
      
      // Use the stored API key from local storage or fall back to the default key
      const storedKey = user?.id ? localStorage.getItem(`youtube_api_key_${user.id}`) : null;
      const apiKey = storedKey || DEFAULT_YOUTUBE_API_KEY;
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
          searchQuery
        )}&type=video&key=${apiKey}`
      );
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      if (!data.items?.[0]) {
        toast({
          title: 'No results',
          description: 'No videos found for your search',
          variant: 'destructive',
        });
        return;
      }

      // Extract and prepare search results
      const results = data.items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title
      }));
      
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching videos:', error);
      toast({
        title: 'Error',
        description: 'Failed to search videos',
        variant: 'destructive',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const playVideo = (videoId: string) => {
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Add from URL</h3>
        <div className="flex gap-2">
          <Input
            placeholder="Paste YouTube video URL..."
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            className="bg-white/5 border-white/20"
          />
          <CustomButton
            onClick={handleAddVideo}
            disabled={!videoUrl.trim() || isAdding}
            className="shrink-0"
          >
            <ExternalLink size={16} />
            <span>Add</span>
          </CustomButton>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Search YouTube</h3>
        <div className="flex gap-2">
          <Input
            placeholder="Search for videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-white/5 border-white/20"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <CustomButton
            onClick={handleSearch}
            disabled={!searchQuery.trim() || isSearching}
            className="shrink-0"
          >
            {isSearching ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Search size={16} />
            )}
            <span>Search</span>
          </CustomButton>
        </div>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
          <h3 className="text-sm font-medium">Search Results</h3>
          {searchResults.map((result) => (
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
                  onClick={() => playVideo(result.id)}
                  title="Play Now"
                >
                  <Play size={16} />
                </CustomButton>
                <CustomButton
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-white hover:bg-white/10"
                  onClick={() => {
                    setIsAdding(true);
                    addVideoToPlaylist(result.id);
                  }}
                  title="Add to Playlist"
                  disabled={isAdding}
                >
                  <ListPlus size={16} />
                </CustomButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlaylistEditor;
