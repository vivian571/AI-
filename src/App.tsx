import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, 
  Play, 
  Pause, 
  RefreshCw, 
  TrendingUp, 
  Image as ImageIcon, 
  Volume2, 
  Loader2, 
  ChevronRight,
  Sparkles,
  Podcast,
  Share2
} from "lucide-react";
import { 
  generatePodcastScript, 
  generateAudio, 
  generateCoverImage, 
  getTrendingTopics,
  PodcastScript 
} from "./services/gemini";
import { cn, encodeWAV } from "./lib/utils";
import ReactMarkdown from "react-markdown";
import JSZip from "jszip";

const VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Zephyr"];

const UI_TEXT = {
  English: {
    title: "Vocalize AI",
    trending: "GitHub Trending",
    topicLabel: "What's the topic?",
    placeholder: "Paste an article, a news highlight, or just a topic you want to hear about...",
    generate: "Generate",
    generating: "Generating...",
    crafting: "Crafting your podcast...",
    craftingSub: "We're generating the script, AI voiceover, and custom cover art.",
    ready: "Ready to broadcast?",
    readySub: "Enter a topic on the left to generate your first AI-powered podcast video.",
    nowPlaying: "Now Playing",
    transcript: "Transcript",
    copy: "Copy",
    copied: "Copied!",
    download: "Download Audio",
    downloadAll: "Export Video (MP4)",
    exporting: "Exporting Video...",
    error: "Failed to generate podcast. Please try again."
  },
  Chinese: {
    title: "AI 播客助手",
    trending: "GitHub 热榜",
    topicLabel: "你想聊什么？",
    placeholder: "粘贴文章、新闻亮点，或者输入你想了解的话题...",
    generate: "生成",
    generating: "生成中...",
    crafting: "正在打造您的播客...",
    craftingSub: "我们正在生成脚本、AI 配音和自定义封面。",
    ready: "准备好播报了吗？",
    readySub: "在左侧输入话题，生成您的第一个 AI 播客视频。",
    nowPlaying: "正在播放",
    transcript: "文案脚本",
    copy: "复制",
    copied: "已复制！",
    download: "下载音频",
    downloadAll: "导出视频 (MP4)",
    exporting: "正在导出视频...",
    error: "生成播客失败，请重试。"
  }
};

export default function App() {
  const [input, setInput] = useState("");
  const [trending, setTrending] = useState<string[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [script, setScript] = useState<PodcastScript | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState("Kore");
  const [language, setLanguage] = useState<"English" | "Chinese">("English");
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [chapters, setChapters] = useState<{ title: string; start: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const t = UI_TEXT[language];

  const copyScript = () => {
    if (!script) return;
    const fullContent = script.sections.map(s => `## ${s.title}\n\n${language === "English" ? s.contentEn : s.contentCn}`).join("\n\n");
    navigator.clipboard.writeText(fullContent);
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
  };

  useEffect(() => {
    let interval: any;
    if (isPlaying && audioContextRef.current) {
      interval = setInterval(() => {
        const time = audioContextRef.current!.currentTime - startTimeRef.current;
        setPlaybackTime(time);
      }, 100);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const downloadAudio = () => {
    if (!audioBase64) return;
    const binaryString = atob(audioBase64);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len; i += 2) {
      bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
    }

    const float32Data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32Data[i] = bytes[i] / 32768.0;
    }

    const blob = encodeWAV(float32Data, 24000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${script?.title || "podcast"}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    if (!audioBase64 || !coverImage || !script) return;
    setExporting(true);
    setExportProgress(10);

    try {
      console.log("Starting video export...");
      // Call server-side export API
      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audioBase64,
          coverImage,
          title: script.title,
          summary: script.summary,
        }),
      });

      setExportProgress(50);

      if (!response.ok) {
        let errorMessage = "Export failed";
        try {
          const errorData = await response.json();
          errorMessage = errorData.details || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      setExportProgress(90);

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = script.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      a.download = `${safeTitle}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setExportProgress(100);
      setTimeout(() => {
        setExporting(false);
        setExportProgress(0);
      }, 1000);
    } catch (err: any) {
      console.error("Failed to export video", err);
      setError(`Failed to export video: ${err.message}`);
      setExporting(false);
      setExportProgress(0);
    }
  };

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  useEffect(() => {
    fetchTrending();
  }, [language]);

  const fetchTrending = async () => {
    setLoadingTrending(true);
    try {
      const topics = await getTrendingTopics(language);
      setTrending(topics);
    } catch (err) {
      console.error("Failed to fetch trending topics", err);
    } finally {
      setLoadingTrending(false);
    }
  };

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setGenerating(true);
    setError(null);
    setScript(null);
    setAudioBase64(null);
    setCoverImage(null);
    setVideoUrl(null);
    setIsPlaying(false);

    try {
      // 1. Generate Script
      setStatus("Generating script...");
      const podcastScript = await generatePodcastScript(input, language);
      setScript(podcastScript);

      // 2. Generate Audio & Image in parallel
      setStatus("Generating audio and cover art...");
      const [audioResult, image] = await Promise.all([
        generateAudio(podcastScript.sections, language, selectedVoice, (msg) => setStatus(msg)),
        generateCoverImage(podcastScript.visualPrompt)
      ]);
      
      setAudioBase64(audioResult.base64Audio);
      setChapters(audioResult.chapters);
      setCoverImage(image);
      setStatus("");
    } catch (err: any) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`${t.error}${errorMessage ? ` (${errorMessage})` : ""}`);
    } finally {
      setGenerating(false);
    }
  };

  const playAudio = async () => {
    if (!audioBase64) return;

    if (isPlaying) {
      audioBufferSourceRef.current?.stop();
      pausedAtRef.current = audioContextRef.current!.currentTime - startTimeRef.current;
      setIsPlaying(false);
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    const binaryString = atob(audioBase64);
    const len = binaryString.length;
    const bytes = new Int16Array(len / 2);
    for (let i = 0; i < len; i += 2) {
      bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
    }

    const float32Data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      float32Data[i] = bytes[i] / 32768.0;
    }

    const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    source.onended = () => {
      setIsPlaying(false);
      pausedAtRef.current = 0;
    };

    startTimeRef.current = audioContextRef.current.currentTime - pausedAtRef.current;
    source.start(0, pausedAtRef.current);
    audioBufferSourceRef.current = source;
    setIsPlaying(true);
  };

  const seekTo = (time: number) => {
    if (!audioContextRef.current || !audioBase64) return;
    
    if (audioBufferSourceRef.current) {
      audioBufferSourceRef.current.stop();
      audioBufferSourceRef.current = null;
    }
    
    pausedAtRef.current = time;
    playAudio();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
      {/* Background Glow */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500 rounded-xl">
              <Podcast className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
              <button 
                onClick={() => setLanguage("English")}
                className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all", language === "English" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white")}
              >
                EN
              </button>
              <button 
                onClick={() => setLanguage("Chinese")}
                className={cn("px-3 py-1 text-xs font-bold rounded-md transition-all", language === "Chinese" ? "bg-orange-500 text-black" : "text-white/40 hover:text-white")}
              >
                CN
              </button>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <button 
              onClick={fetchTrending}
              disabled={loadingTrending}
              className="p-2 hover:bg-white/5 rounded-full transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn("w-5 h-5", loadingTrending && "animate-spin")} />
            </button>
            <div className="h-6 w-px bg-white/10" />
            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full border border-white/10">
              <Volume2 className="w-4 h-4 text-orange-500" />
              <select 
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="bg-transparent text-sm font-medium outline-none cursor-pointer"
              >
                {VOICES.map(v => <option key={v} value={v} className="bg-[#1a1a1a]">{v}</option>)}
              </select>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Input */}
          <div className="lg:col-span-5 space-y-8">
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500" />
                {t.topicLabel}
              </h2>
              <div className="relative group">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t.placeholder}
                  className="w-full h-48 bg-white/5 border border-white/10 rounded-2xl p-6 text-lg outline-none focus:border-orange-500/50 transition-all resize-none placeholder:text-white/20"
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !input.trim()}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-orange-500 text-black font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all transform active:scale-95"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {t.generating}
                      </>
                    ) : (
                      <>
                        {t.generate}
                        <ChevronRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-medium text-white/40 uppercase tracking-wider mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                {t.trending}
              </h3>
              <div className="flex flex-wrap gap-2">
                {trending.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(topic)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-sm transition-all"
                  >
                    {topic}
                  </button>
                ))}
                {loadingTrending && (
                  <div className="flex gap-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="w-24 h-8 bg-white/5 animate-pulse rounded-full" />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {generating ? (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="h-full flex flex-col items-center justify-center space-y-6 bg-white/5 rounded-3xl border border-dashed border-white/10 p-12"
                >
                  <div className="relative">
                    <div className="w-24 h-24 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                    <Podcast className="absolute inset-0 m-auto w-8 h-8 text-orange-500" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-xl font-bold mb-2">{t.crafting}</h3>
                    <p className="text-white/40 max-w-xs">{status || t.craftingSub}</p>
                  </div>
                </motion.div>
              ) : script ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-8"
                >
                  {/* Video/Audio Player Card */}
                  <div className="relative aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl group">
                    {videoUrl ? (
                      <video 
                        src={videoUrl} 
                        controls 
                        className="w-full h-full object-contain"
                        autoPlay
                      />
                    ) : (
                      <>
                        {coverImage ? (
                          <img 
                            src={coverImage} 
                            alt="Podcast Cover" 
                            className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-orange-500/20 to-blue-500/20 flex items-center justify-center">
                            <ImageIcon className="w-12 h-12 text-white/20" />
                          </div>
                        )}
                        
                        {/* Waveform Overlay (Simulated) */}
                        {isPlaying && (
                          <div className="absolute inset-0 flex items-center justify-center gap-1 pointer-events-none">
                            {[...Array(20)].map((_, i) => (
                              <motion.div
                                key={i}
                                animate={{ height: [20, 60, 20] }}
                                transition={{ 
                                  duration: 0.5 + Math.random() * 0.5, 
                                  repeat: Infinity,
                                  delay: i * 0.05
                                }}
                                className="w-1 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                              />
                            ))}
                          </div>
                        )}

                        {/* Subtitles */}
                        {isPlaying && script && chapters.length > 0 && (
                          <div className="absolute bottom-32 left-8 right-8 z-20 pointer-events-none">
                            <AnimatePresence mode="wait">
                              {(() => {
                                const currentIdx = chapters.reduce((acc, c, idx) => playbackTime >= c.start ? idx : acc, -1);
                                const section = script.sections[currentIdx];
                                if (!section) return null;
                                return (
                                  <motion.div
                                    key={currentIdx}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="bg-black/60 backdrop-blur-md p-4 rounded-xl border border-white/10 text-center space-y-2"
                                  >
                                    <p className="text-white font-medium text-lg leading-tight">
                                      {section.contentEn}
                                    </p>
                                    <p className="text-orange-400 font-medium text-base leading-tight">
                                      {section.contentCn}
                                    </p>
                                  </motion.div>
                                );
                              })()}
                            </AnimatePresence>
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        
                        <div className="absolute bottom-8 left-8 right-8 flex items-end justify-between">
                          <div className="space-y-2">
                            <span className="text-xs font-bold uppercase tracking-widest text-orange-500">{t.nowPlaying}</span>
                            <h3 className="text-2xl font-bold">{script.title}</h3>
                            <p className="text-white/60 text-sm line-clamp-1">{script.summary}</p>
                          </div>
                          <button 
                            onClick={playAudio}
                            className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform active:scale-95 shadow-xl"
                          >
                            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Chapters Section */}
                  {chapters.length > 0 && (
                    <div className="bg-white/5 rounded-3xl p-8 border border-white/10 space-y-6">
                      <h3 className="font-bold flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-orange-500" />
                        Chapters
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {chapters.map((chapter, idx) => (
                          <button
                            key={idx}
                            onClick={() => seekTo(chapter.start)}
                            className="flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-orange-500/30 rounded-2xl transition-all group text-left"
                          >
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-sm font-bold text-white group-hover:text-orange-500 transition-colors truncate">
                                {chapter.title}
                              </span>
                              <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                                {formatTime(chapter.start)}
                              </span>
                            </div>
                            <div className="p-2 bg-white/5 rounded-lg group-hover:bg-orange-500 group-hover:text-black transition-all">
                              <Play className="w-3 h-3 fill-current" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Script Section */}
                  <div className="bg-white/5 rounded-3xl p-8 border border-white/10 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold flex items-center gap-2">
                        <Mic className="w-4 h-4 text-orange-500" />
                        {t.transcript}
                      </h3>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={copyScript}
                          className="p-2 hover:bg-white/5 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
                        >
                          {copying ? t.copied : t.copy}
                          <Share2 className="w-4 h-4 text-white/40" />
                        </button>
                        <button 
                          onClick={downloadAudio}
                          className="p-2 hover:bg-white/5 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5"
                        >
                          {t.download}
                          <Volume2 className="w-4 h-4 text-white/40" />
                        </button>
                        <button 
                          onClick={downloadAll}
                          disabled={exporting}
                          className="p-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 rounded-lg transition-colors text-xs font-bold flex items-center gap-1.5"
                        >
                          {exporting ? `${exportProgress}%` : t.downloadAll}
                          <Share2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-invert max-w-none text-white/70 leading-relaxed prose-headings:text-white prose-strong:text-orange-500">
                      {script.sections.map((section, idx) => (
                        <div key={idx} className="mb-8 last:mb-0">
                          <h4 className="text-lg font-bold mb-3 text-white flex items-center gap-2">
                            <span className="text-orange-500/50 font-mono text-sm">{idx + 1}.</span>
                            {section.title}
                          </h4>
                          <div className="space-y-4">
                            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                              <p className="text-white/90 font-medium mb-2 text-xs uppercase tracking-widest opacity-50">English</p>
                              <ReactMarkdown>{section.contentEn}</ReactMarkdown>
                            </div>
                            <div className="p-4 bg-orange-500/5 rounded-xl border border-orange-500/10">
                              <p className="text-orange-500/90 font-medium mb-2 text-xs uppercase tracking-widest opacity-50">Chinese</p>
                              <ReactMarkdown>{section.contentCn}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center space-y-6 bg-white/5 rounded-3xl border border-dashed border-white/10 p-12 text-center">
                  <div className="p-6 bg-white/5 rounded-full">
                    <Podcast className="w-12 h-12 text-white/20" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-2">{t.ready}</h3>
                    <p className="text-white/40 max-w-xs mx-auto">{t.readySub}</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Export Overlay */}
      <AnimatePresence>
        {exporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative mb-8">
              <div className="w-32 h-32 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center font-mono text-xl font-bold text-orange-500">
                {exportProgress}%
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-2">{t.exporting}</h2>
            <p className="text-white/40 max-w-sm">
              Please keep this tab open. We are recording the audio and visuals into a video file.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-full font-bold shadow-2xl z-50"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
