
import React, { useState, useCallback, useRef } from 'react';
import Header from './components/Header';
import InputArea from './components/InputArea';
import ResponseDisplay from './components/ResponseDisplay';
import { getLifeAdviceStream, getSpeechAudio } from './services/geminiService';

// Audio decoding utilities
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<string>('');
  const [thinkingMode, setThinkingMode] = useState<boolean>(true);

  const captionTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopAllProcesses = useCallback(() => {
    if (captionTimeoutRef.current) {
      clearTimeout(captionTimeoutRef.current);
    }
    if (audioSourceRef.current) {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
    }
    setIsLoading(false);
    setIsSpeaking(false);
  }, []);

  const handleSubmit = useCallback(async (prompt: string) => {
    if (!prompt.trim()) {
      setError("Tell me what's troubling ye, matey!");
      return;
    }
    
    stopAllProcesses();
    setIsLoading(true);
    setError(null);
    setResponse('');

    try {
      let fullText = '';
      const stream = getLifeAdviceStream(prompt, thinkingMode);
      // Silently accumulate the full text without displaying it first
      for await (const chunk of stream) {
        fullText += chunk;
      }

      const audioData = await getSpeechAudio(fullText);
      if (!audioData) {
        setResponse(fullText); // Show text if audio fails
        setIsLoading(false);
        return; // End here if no audio is generated
      }
      
      if (!audioContextRef.current) {
        // FIX: Cast window to any to allow webkitAudioContext for older browser compatibility
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const audioContext = audioContextRef.current;
      const audioBuffer = await decodeAudioData(decode(audioData), audioContext, 24000, 1);

      const words = fullText.split(/(\s+)/); // Keep spaces for formatting
      const totalDuration = audioBuffer.duration;
      const delayPerWord = (totalDuration * 1000) / (words.length || 1);
      
      setResponse(''); // Ensure response is clear before starting caption effect
      setIsSpeaking(true);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
      audioSourceRef.current = source;

      source.onended = () => {
        setIsSpeaking(false);
        setIsLoading(false);
        setResponse(fullText); // Ensure final text is complete
        if (captionTimeoutRef.current) {
            clearTimeout(captionTimeoutRef.current);
        }
        audioSourceRef.current = null;
      };

      let wordIndex = 0;
      const showNextWord = () => {
        if (wordIndex < words.length) {
          setResponse(prev => prev + words[wordIndex]);
          wordIndex++;
          captionTimeoutRef.current = window.setTimeout(showNextWord, delayPerWord);
        }
      };
      
      showNextWord();

    } catch (err) {
      setError(err instanceof Error ? err.message : "The winds turned against us! An unknown error occurred. Please try again.");
      stopAllProcesses();
    }
  }, [thinkingMode, stopAllProcesses]);

  return (
    <div className="flex flex-col min-h-screen font-sans text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <Header />
      <main className="flex-grow container mx-auto p-4 md:p-6 lg:p-8 flex flex-col">
        <div className="flex-grow flex flex-col gap-6 w-full max-w-4xl mx-auto">
          <ResponseDisplay
            isLoading={isLoading}
            error={error}
            response={response}
            isThinking={thinkingMode}
            isSpeaking={isSpeaking}
          />
          <div className="mt-auto">
            <InputArea
              onSubmit={handleSubmit}
              isLoading={isLoading}
              thinkingMode={thinkingMode}
              onThinkingModeChange={setThinkingMode}
            />
          </div>
        </div>
      </main>
      <footer className="text-center p-4 text-xs text-slate-400 dark:text-slate-500">
        <p>Captain Clarity's Compass | Powered by Gemini 2.5 Pro</p>
      </footer>
    </div>
  );
};

export default App;
