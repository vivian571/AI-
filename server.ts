import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set ffmpeg path
if (ffmpegStatic) {
  console.log("Setting FFmpeg path to:", ffmpegStatic);
  ffmpeg.setFfmpegPath(ffmpegStatic);
} else {
  console.warn("ffmpeg-static not found, relying on system ffmpeg");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ limit: "100mb", extended: true }));

  // API: Export Video
  app.post("/api/export", async (req, res) => {
    const { audioBase64, coverImage, title, summary } = req.body;
    
    if (!audioBase64 || !coverImage) {
      return res.status(400).json({ error: "Missing data" });
    }

    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const audioPath = path.join(tempDir, `audio_${timestamp}.raw`);
    const imagePath = path.join(tempDir, `image_${timestamp}.png`);
    const outputPath = path.join(tempDir, `output_${timestamp}.mp4`);

    try {
      // Write temp files
      console.log(`Writing temp files to ${tempDir}...`);
      fs.writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));
      
      const imageBuffer = Buffer.from(coverImage.split(",")[1], "base64");
      fs.writeFileSync(imagePath, imageBuffer);

      if (!fs.existsSync(audioPath) || !fs.existsSync(imagePath)) {
        throw new Error("Failed to write temporary files");
      }

      console.log("Starting FFmpeg process...");
      
      ffmpeg()
        .input(imagePath)
        .inputOptions(["-loop 1"])
        .input(audioPath)
        .inputFormat("s16le")
        .inputOptions(["-ar 24000", "-ac 1"])
        .outputOptions([
          "-c:v libx264",
          "-tune stillimage",
          "-c:a aac",
          "-b:a 192k",
          "-pix_fmt yuv420p",
          "-shortest",
          "-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"
        ])
        .on("start", (commandLine) => {
          console.log("FFmpeg command:", commandLine);
        })
        .on("end", () => {
          console.log("FFmpeg finished successfully");
          const safeTitle = (title || "podcast").replace(/[^a-z0-9]/gi, "_").toLowerCase();
          res.download(outputPath, `${safeTitle}.mp4`, (err) => {
            if (err) console.error("Download error:", err);
            // Cleanup
            try {
              if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
              if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
              if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch (cleanupErr) {
              console.error("Cleanup error:", cleanupErr);
            }
          });
        })
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg error:", err.message);
          console.error("FFmpeg stderr:", stderr);
          
          if (!res.headersSent) {
            res.status(500).json({ 
              error: "Video processing failed", 
              details: err.message,
              stderr: stderr 
            });
          }
          
          // Cleanup
          try {
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (cleanupErr) {
            console.error("Cleanup error:", cleanupErr);
          }
        })
        .save(outputPath);

    } catch (err: any) {
      console.error("Export error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Server error", details: err.message });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
