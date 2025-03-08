
import React from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { CustomButton } from '@/components/ui/custom-button';
import { Play, Trash2, ChevronUp, ChevronDown, Bookmark } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

export interface PlaylistItemType {
  id: string;
  video_id: string;
  title: string;
  position: number;
  added_by: string;
}

export interface PlaylistItemProps {
  key?: string;
  item: PlaylistItemType;
  isPlaying: boolean;
  onPlay: () => void;
  onRemove: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
  onSave?: () => void;
}

const PlaylistItem: React.FC<PlaylistItemProps> = ({
  item,
  isPlaying,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  onSave
}) => {
  const isMobile = useIsMobile();
  
  return (
    <GlassCard className={`mb-2 p-2 ${isPlaying ? 'ring-1 ring-primary' : ''}`}>
      <div className="flex items-center gap-2">
        <img
          src={`https://i.ytimg.com/vi/${item.video_id}/default.jpg`}
          alt={item.title}
          className="w-16 h-12 object-cover rounded"
        />
        <div className="flex-1 truncate">
          <p className="text-sm font-medium truncate text-white">
            {item.title}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <CustomButton
            size="icon"
            variant={isPlaying ? "default" : "ghost"}
            className="h-6 w-6 text-white hover:bg-white/10"
            onClick={onPlay}
            title="Play"
          >
            <Play size={14} className={isPlaying ? "fill-white" : "fill-white/20"} />
          </CustomButton>
        </div>
      </div>

      {isMobile ? (
        <div className="flex justify-between mt-2 gap-1">
          <CustomButton
            size="sm"
            variant="ghost"
            className="flex-1 h-7 text-xs"
            onClick={onMoveUp}
            title="Move Up"
          >
            <ChevronUp size={14} />
            <span className="ml-1">Up</span>
          </CustomButton>
          <CustomButton
            size="sm"
            variant="ghost"
            className="flex-1 h-7 text-xs"
            onClick={onMoveDown}
            title="Move Down"
          >
            <ChevronDown size={14} />
            <span className="ml-1">Down</span>
          </CustomButton>
          <CustomButton
            size="sm"
            variant="ghost"
            className="flex-1 h-7 text-xs"
            onClick={onRemove}
            title="Remove"
          >
            <Trash2 size={14} />
            <span className="ml-1">Remove</span>
          </CustomButton>
          {onSave && (
            <CustomButton
              size="sm"
              variant="ghost"
              className="flex-1 h-7 text-xs"
              onClick={onSave}
              title="Save"
            >
              <Bookmark size={14} />
              <span className="ml-1">Save</span>
            </CustomButton>
          )}
        </div>
      ) : (
        <div className="flex justify-end mt-2 gap-1">
          <CustomButton
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-white hover:bg-white/10"
            onClick={onMoveUp}
            title="Move Up"
          >
            <ChevronUp size={14} />
          </CustomButton>
          <CustomButton
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-white hover:bg-white/10"
            onClick={onMoveDown}
            title="Move Down"
          >
            <ChevronDown size={14} />
          </CustomButton>
          <CustomButton
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-white hover:bg-white/10"
            onClick={onRemove}
            title="Remove"
          >
            <Trash2 size={14} />
          </CustomButton>
          {onSave && (
            <CustomButton
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-white hover:bg-white/10"
              onClick={onSave}
              title="Save"
            >
              <Bookmark size={14} />
            </CustomButton>
          )}
        </div>
      )}
    </GlassCard>
  );
};

export default PlaylistItem;
