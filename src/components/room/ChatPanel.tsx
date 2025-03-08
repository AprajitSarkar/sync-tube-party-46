
import React, { useState, useEffect, useRef } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { CustomButton } from '@/components/ui/custom-button';
import { SendHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import ChatMessage from './ChatMessage';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import LogToast from '@/components/common/LogToast';
import { useIsMobile } from '@/hooks/use-mobile';

interface ChatPanelProps {
  roomId: string;
}

interface Message {
  id: string;
  user_id: string;
  room_id: string;
  content: string;
  created_at: string;
  user_email?: string;
  type?: 'message' | 'activity';
}

const ChatPanel = ({ roomId }: ChatPanelProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [logMessage, setLogMessage] = useState('');
  const [logVisible, setLogVisible] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    fetchMessages();

    const messagesSubscription = supabase
      .channel(`messages:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const newMessage = payload.new as Message;
        
        getUserEmail(newMessage.user_id).then((userEmail) => {
          setMessages((prev) => [
            ...prev, 
            { ...newMessage, user_email: userEmail }
          ]);
        });
      })
      .subscribe();

    const roomEvents = supabase
      .channel(`room-events:${roomId}`)
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const userEmail = newPresences[0]?.email || 'Someone';
        addActivityLog(`${userEmail} joined the room`);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const userEmail = leftPresences[0]?.email || 'Someone';
        addActivityLog(`${userEmail} left the room`);
      })
      .subscribe();

    const videoEvents = supabase
      .channel(`video-events:${roomId}`)
      .on('broadcast', { event: 'video-state' }, (payload) => {
        const { user, action } = payload;
        const userEmail = user?.email || 'Someone';
        
        switch (action) {
          case 'play':
            addActivityLog(`${userEmail} started playing the video`);
            break;
          case 'pause':
            addActivityLog(`${userEmail} paused the video`);
            break;
          case 'seek':
            addActivityLog(`${userEmail} seeked the video`);
            break;
          default:
            break;
        }
      })
      .subscribe();

    return () => {
      messagesSubscription.unsubscribe();
      roomEvents.unsubscribe();
      videoEvents.unsubscribe();
    };
  }, [roomId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const showLog = (message: string) => {
    setLogMessage(message);
    setLogVisible(true);
  };

  const hideLog = () => {
    setLogVisible(false);
  };

  const fetchMessages = async () => {
    try {
      setIsLoading(true);
      showLog("Loading messages...");
      
      if (!roomId || !roomId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        
        const messagesWithUserEmails = await Promise.all(
          (data || []).map(async (message) => {
            const userEmail = await getUserEmail(message.user_id);
            return { ...message, user_email: userEmail };
          })
        );

        setMessages(messagesWithUserEmails);
      } else {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        
        const messagesWithUserEmails = await Promise.all(
          (data || []).map(async (message) => {
            const userEmail = await getUserEmail(message.user_id);
            return { ...message, user_email: userEmail };
          })
        );

        setMessages(messagesWithUserEmails);
      }
      
      showLog("Messages loaded");
    } catch (error) {
      console.error('Error fetching messages:', error);
      showLog("Failed to load messages");
      toast({
        title: 'Error',
        description: 'Failed to load messages',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getUserEmail = async (userId: string): Promise<string> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data?.email || 'Anonymous';
    } catch {
      return 'Anonymous';
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !user) return;

    try {
      setIsSending(true);
      showLog("Sending message...");
      
      const { error } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          user_id: user.id,
          content: inputMessage.trim(),
        });

      if (error) throw error;
      setInputMessage('');
      showLog("Message sent");
    } catch (error) {
      console.error('Error sending message:', error);
      showLog("Failed to send message");
      toast({
        title: 'Error',
        description: 'Failed to send message',
        variant: 'destructive'
      });
    } finally {
      setIsSending(false);
    }
  };

  const addActivityLog = (content: string) => {
    const activityMessage: Message = {
      id: Date.now().toString(),
      user_id: 'system',
      room_id: roomId,
      content,
      created_at: new Date().toISOString(),
      type: 'activity'
    };
    
    setMessages(prev => [...prev, activityMessage]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
      
      <GlassCard className={`flex flex-col ${isMobile ? 'h-[calc(100vh-280px)]' : 'h-full'}`}>
        <div className="p-3 border-b border-white/10">
          <h3 className="font-medium">Chat</h3>
        </div>
        
        {isMobile ? (
          // Mobile chat layout with fixed position for messages container and input at bottom
          <div className="flex flex-col flex-1 overflow-hidden relative">
            <div className="absolute inset-0 pb-16 flex flex-col">
              <div className="flex-1 overflow-y-auto px-3 py-4">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <p>No messages yet. Say hello!</p>
                  </div>
                ) : (
                  <div className="flex flex-col space-y-2">
                    {messages.map((message) => (
                      message.type === 'activity' ? (
                        <div 
                          key={message.id}
                          className="text-xs text-muted-foreground text-center my-2 italic"
                        >
                          {message.content}
                        </div>
                      ) : (
                        <ChatMessage 
                          key={message.id} 
                          message={message} 
                          currentUser={user}
                        />
                      )
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
              
              <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10 bg-[#1A0B33]">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-10 bg-white/5 border-white/10"
                    disabled={isSending}
                  />
                  <CustomButton
                    size="sm"
                    variant="glow"
                    onClick={sendMessage}
                    disabled={!inputMessage.trim() || isSending}
                    isLoading={isSending}
                  >
                    <SendHorizontal size={18} />
                  </CustomButton>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Desktop chat layout with ScrollArea
          <div className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1">
              <div className="p-4">
                {messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <p>No messages yet. Say hello!</p>
                  </div>
                ) : (
                  <div className="flex flex-col space-y-3">
                    {messages.map((message) => (
                      message.type === 'activity' ? (
                        <div 
                          key={message.id}
                          className="text-xs text-muted-foreground text-center my-2 italic"
                        >
                          {message.content}
                        </div>
                      ) : (
                        <ChatMessage 
                          key={message.id} 
                          message={message} 
                          currentUser={user}
                        />
                      )
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>
            </ScrollArea>
            
            <div className="p-3 border-t border-white/10">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-10 bg-white/5 border-white/10"
                  disabled={isSending}
                />
                <CustomButton
                  size="sm"
                  variant="glow"
                  onClick={sendMessage}
                  disabled={!inputMessage.trim() || isSending}
                  isLoading={isSending}
                >
                  <SendHorizontal size={18} />
                </CustomButton>
              </div>
            </div>
          </div>
        )}
      </GlassCard>
    </>
  );
};

export default ChatPanel;
