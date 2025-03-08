
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Save, Trash2, ListPlus, MoveUp, MoveDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PlaylistItem from './PlaylistItem';
import SaveToPlaylistModal from './SaveToPlaylistModal';
import LoadingSpinner from '@/components/common/LoadingSpinner';

interface PlaylistItemType {
  id: string;
  video_id: string;
  title: string;
  position: number;
  added_by: string;
}

interface PlaylistPanelProps {
  roomId: string;
  currentVideoId: string;
  onPlayVideo: (videoId: string) => void;
}

const PlaylistPanel = ({ roomId, currentVideoId, onPlayVideo }: PlaylistPanelProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [playlistItems, setPlaylistItems] = useState<PlaylistItemType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (roomId) {
      fetchPlaylist();
    }
  }, [roomId]);

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

  return (
    <GlassCard className="h-full flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 border-b border-white/10">
        <h2 className="font-semibold">Room Playlist</h2>
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
      
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <LoadingSpinner size="md" />
          </div>
        ) : playlistItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
            <ListPlus size={40} className="opacity-20 mb-2" />
            <p>Playlist is empty</p>
            <p className="text-sm">Add videos to get started</p>
          </div>
        ) : (
          <div className="space-y-2">
            {playlistItems.map((item, index) => (
              <PlaylistItem 
                key={item.id}
                item={item}
                isPlaying={item.video_id === currentVideoId}
                onPlay={() => onPlayVideo(item.video_id)}
                onRemove={() => removeItem(item.id)}
                onMoveUp={index > 0 ? () => moveItem(item.id, 'up') : undefined}
                onMoveDown={index < playlistItems.length - 1 ? () => moveItem(item.id, 'down') : undefined}
              />
            ))}
          </div>
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
};

export default PlaylistPanel;
