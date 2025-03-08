
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Play, Plus, BookmarkPlus } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface UserPlaylistsProps {
  onPlayVideo: (videoId: string) => void;
  onAddToRoomPlaylist: (videoId: string, title: string) => void;
}

const UserPlaylists = ({ onPlayVideo, onAddToRoomPlaylist }: UserPlaylistsProps) => {
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUserPlaylists();
    }
  }, [user]);

  const fetchUserPlaylists = async () => {
    try {
      const { data: playlistsData, error: playlistsError } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', user?.id);

      if (playlistsError) throw playlistsError;

      const playlistsWithItems = await Promise.all(
        playlistsData.map(async (playlist) => {
          const { data: items, error: itemsError } = await supabase
            .from('user_playlist_items')
            .select('*')
            .eq('user_id', user?.id)
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
  };

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
    setIsSaving(true);
    try {
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
    }
  };

  return (
    <div className="space-y-4">
      {playlists.length === 0 && !isLoading ? (
        <div className="text-center p-4">
          <p>You don't have any playlists yet.</p>
        </div>
      ) : (
        playlists.map((playlist) => (
          <GlassCard key={playlist.id} className="p-4" intensity="light">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">{playlist.name}</h3>
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
