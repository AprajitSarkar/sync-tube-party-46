
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CustomButton } from '@/components/ui/custom-button';
import { useToast } from '@/hooks/use-toast';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { LibraryBig, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SaveToPlaylistModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (playlistId: string) => Promise<void>;
  videos: { video_id: string; title: string }[];
}

const SaveToPlaylistModal = ({ open, onClose, onSave, videos }: SaveToPlaylistModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    if (open && user) {
      fetchUserPlaylists();
    }
  }, [open, user]);

  const fetchUserPlaylists = async () => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      
      const { data, error } = await supabase
        .from('user_playlists')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      setPlaylists(data || []);
    } catch (error) {
      console.error('Error fetching playlists:', error);
      toast({
        title: 'Error',
        description: 'Failed to load your playlists',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const createPlaylist = async () => {
    if (!newPlaylistName.trim() || !user) return;
    
    try {
      setIsCreating(true);
      const { data, error } = await supabase
        .from('user_playlists')
        .insert({
          name: newPlaylistName.trim(),
          user_id: user.id
        })
        .select()
        .single();
        
      if (error) throw error;
      
      setPlaylists([data, ...playlists]);
      setNewPlaylistName('');
      setSelectedPlaylistId(data.id);
      
      toast({
        title: 'Success',
        description: 'Playlist created successfully',
      });
    } catch (error: any) {
      console.error('Error creating playlist:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create playlist',
        variant: 'destructive'
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPlaylistId) {
      toast({
        title: 'No playlist selected',
        description: 'Please select a playlist or create a new one',
        variant: 'destructive'
      });
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(selectedPlaylistId);
      onClose();
    } catch (error) {
      console.error('Error saving videos:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LibraryBig className="h-5 w-5" />
            Save {videos.length} videos to playlist
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 my-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="New playlist name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="bg-white/5 border-white/20"
              />
              <Button 
                onClick={createPlaylist}
                disabled={!newPlaylistName.trim() || isCreating}
              >
                {isCreating ? (
                  <LoadingSpinner size="sm" className="mr-2" />
                ) : (
                  <Plus size={16} className="mr-2" />
                )}
                Create
              </Button>
            </div>
          </div>
          
          {isLoading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner size="md" />
            </div>
          ) : playlists.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground">You don't have any playlists yet</p>
              <p className="text-sm mt-1">Create a new playlist to continue</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {playlists.map(playlist => (
                <div 
                  key={playlist.id}
                  className={`p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedPlaylistId === playlist.id 
                      ? 'border-primary bg-primary/10' 
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                  onClick={() => setSelectedPlaylistId(playlist.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{playlist.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(playlist.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <CustomButton 
            onClick={handleSave} 
            isLoading={isSaving}
            disabled={!selectedPlaylistId || isSaving}
          >
            Save All Videos
          </CustomButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SaveToPlaylistModal;
