
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Play, Plus, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/common/LoadingSpinner';

interface UserPlaylistsProps {
  onPlayVideo: (videoId: string) => void;
  onAddToRoomPlaylist: (videoId: string, title: string) => void;
  roomPlaylistItems?: any[];
}

const UserPlaylists = ({ onPlayVideo, onAddToRoomPlaylist, roomPlaylistItems = [] }: UserPlaylistsProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const fetchUserPlaylists = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setIsLoading(true);
      
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', user.id);

      if (playlistsError) throw playlistsError;

      const playlistsWithItems = await Promise.all(
        playlistsData.map(async (playlist) => {
          const { data: items, error: itemsError } = await supabase
            .from('user_playlist_items')
            .select('*')
            .eq('user_id', user.id)
            .eq('playlist_id', playlist.id)
            .order('position', { ascending: true });

          if (itemsError) throw itemsError;

          return {
            ...playlist,
            items: items || []
          };
        })
      );

      setPlaylists(playlistsWithItems);
    } catch (error) {
      console.error('Error fetching playlists:', error);
      toast({
        title: 'Error',
        description: 'Failed to load playlists',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      fetchUserPlaylists();
    }
  }, [user, fetchUserPlaylists]);

  const playEntirePlaylist = async (playlistItems: any[]) => {
    try {
      // Play first video immediately
      if (playlistItems.length > 0) {
        onPlayVideo(playlistItems[0].video_id);
      }

      // Add rest to room playlist
      for (let i = 1; i < playlistItems.length; i++) {
        const item = playlistItems[i];
        await onAddToRoomPlaylist(item.video_id, item.title);
      }

      toast({
        title: 'Playlist Added',
        description: 'All videos have been added to the room playlist',
      });
    } catch (error) {
      console.error('Error playing playlist:', error);
      toast({
        title: 'Error',
        description: 'Failed to play playlist',
        variant: 'destructive'
      });
    }
  };

  const saveVideoToPlaylist = async (videoId: string, title: string, playlist: any) => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      // Check if the video already exists in the playlist
      const { data: existingItems } = await supabase
        .from('user_playlist_items')
        .select('id')
        .eq('playlist_id', playlist.id)
        .eq('video_id', videoId)
        .eq('user_id', user?.id);
      
      if (existingItems && existingItems.length > 0) {
        toast({
          title: 'Info',
          description: 'This video is already in the playlist',
        });
        return;
      }

      // Get current max position
      const { data: currentItems } = await supabase
        .from('user_playlist_items')
        .select('position')
        .eq('playlist_id', playlist.id)
        .order('position', { ascending: false })
        .limit(1);

      const nextPosition = (currentItems?.[0]?.position ?? -1) + 1;

      // Add video to playlist
      const { error } = await supabase
        .from('user_playlist_items')
        .insert({
          playlist_id: playlist.id,
          user_id: user?.id,
          video_id: videoId,
          title: title,
          position: nextPosition
        });

      if (error) {
        console.error('Error inserting to playlist:', error);
        throw error;
      }

      toast({
        title: 'Success',
        description: `Video saved to ${playlist.name}`,
      });

      // Refresh playlists
      await fetchUserPlaylists();
      
    } catch (error) {
      console.error('Error saving video:', error);
      toast({
        title: 'Error',
        description: 'Failed to save video to playlist',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
      setSelectedPlaylistId(null);
    }
  };

  const addAllToPlaylist = async (playlistId: string) => {
    if (!roomPlaylistItems || roomPlaylistItems.length === 0) {
      toast({
        title: 'Info',
        description: 'No videos in room playlist to add',
      });
      return;
    }
    
    setIsSaving(true);
    try {
      let successCount = 0;
      
      for (const item of roomPlaylistItems) {
        // Check if the video already exists in the playlist
        const { data: existingItems } = await supabase
          .from('user_playlist_items')
          .select('id')
          .eq('playlist_id', playlistId)
          .eq('video_id', item.video_id)
          .eq('user_id', user?.id);
        
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
            user_id: user?.id,
            video_id: item.video_id,
            title: item.title,
            position: nextPosition
          });

        if (!error) {
          successCount++;
        }
      }

      const playlist = playlists.find(p => p.id === playlistId);
      
      toast({
        title: 'Success',
        description: `Added ${successCount} videos to ${playlist?.name}`,
      });

      // Refresh playlists
      await fetchUserPlaylists();
      
    } catch (error) {
      console.error('Error adding all to playlist:', error);
      toast({
        title: 'Error',
        description: 'Failed to add videos to playlist',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {playlists.length === 0 && !isLoading ? (
        <div className="text-center p-4">
          <p>You don't have any playlists yet.</p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center p-4">
          <LoadingSpinner size="md" />
        </div>
      ) : (
        playlists.map((playlist) => (
          <GlassCard key={playlist.id} className="p-4" intensity="light">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">{playlist.name}</h3>
              <div className="flex gap-2">
                {roomPlaylistItems && roomPlaylistItems.length > 0 && (
                  <CustomButton
                    size="sm"
                    variant="outline"
                    onClick={() => addAllToPlaylist(playlist.id)}
                    disabled={isSaving}
                    className="text-xs"
                  >
                    {isSaving ? <LoadingSpinner size="sm" /> : <Save size={14} className="mr-1" />}
                    Add All
                  </CustomButton>
                )}
                <CustomButton
                  size="sm"
                  variant="glow"
                  onClick={() => playEntirePlaylist(playlist.items)}
                  icon={<Play size={16} />}
                  disabled={playlist.items.length === 0}
                >
                  Play All
                </CustomButton>
              </div>
            </div>
            <div className="space-y-2">
              {playlist.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No videos in this playlist</p>
              ) : (
                playlist.items.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-2 hover:bg-white/10 rounded">
                    <span className="truncate">{item.title}</span>
                    <div className="flex gap-2">
                      <CustomButton
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => onPlayVideo(item.video_id)}
                      >
                        <Play size={16} />
                      </CustomButton>
                      <CustomButton
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => onAddToRoomPlaylist(item.video_id, item.title)}
                      >
                        <Plus size={16} />
                      </CustomButton>
                    </div>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        ))
      )}
    </div>
  );
};

export default UserPlaylists;
