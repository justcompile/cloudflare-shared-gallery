import type { ApiImage } from "../../shared/types";
import type { MediaInfo as MediaInfoParser } from "mediainfo.js";
import * as api from "./api";

type VideoMetadata = {
  width: number | null;
  height: number | null;
  takenAt: number | null;
  camera: string | null;
  durationMs: number | null;
};

let wasmUrlPromise: Promise<string> | null = null;
let parserPromise: Promise<MediaInfoParser> | null = null;
let parserQueue: Promise<void> = Promise.resolve();

async function getWasmUrl(): Promise<string> {
  wasmUrlPromise ??= import("mediainfo.js/MediaInfoModule.wasm?url").then((module) => module.default);
  return wasmUrlPromise;
}

function getParser(): Promise<MediaInfoParser> {
  if (!parserPromise) {
    parserPromise = Promise.all([import("mediainfo.js"), getWasmUrl()]).then(
      ([module, wasmUrl]) =>
        module.default({
          format: "object",
          locateFile: () => wasmUrl,
          chunkSize: 512 * 1024,
        }),
    );
    void parserPromise.catch(() => {
      parserPromise = null;
    });
  }
  return parserPromise;
}

function positiveDimension(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function captureTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) &&
    timestamp > Date.UTC(1980, 0, 1) &&
    timestamp < Date.now() + 86_400_000
    ? timestamp
    : null;
}

function cameraName(values: Array<string | undefined>): string | null {
  const name = values.find((value) => typeof value === "string" && value.trim().length > 0);
  return name ? name.trim().slice(0, 80) : null;
}

async function extractVideoMetadata(image: ApiImage): Promise<VideoMetadata> {
  const previous = parserQueue;
  let release: () => void = () => {};
  parserQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const parser = await getParser();
    const result = await parser.analyzeData(
      image.sizeBytes,
      (size, offset) => api.readMediaRange(image.mediaKey, offset, size),
    );
    const tracks = result.media?.track ?? [];
    const general = tracks.find((track) => track["@type"] === "General");
    const video = tracks.find((track) => track["@type"] === "Video");
    const durationMs =
      (general?.["@type"] === "General" ? general.Duration : undefined) ??
      (video?.["@type"] === "Video" ? video.Duration : undefined);
    return {
      width:
        (video?.["@type"] === "Video" ? positiveDimension(video.Width) : null) ?? image.width,
      height:
        (video?.["@type"] === "Video" ? positiveDimension(video.Height) : null) ?? image.height,
      takenAt:
        (general?.["@type"] === "General" ? captureTimestamp(general.Recorded_Date) : null) ??
        image.takenAt,
      camera:
        (general?.["@type"] === "General"
          ? cameraName([
              general.Encoded_Hardware_Model,
              general.Encoded_Hardware_String,
              general.Encoded_Hardware,
            ])
          : null) ?? image.camera,
      durationMs:
        durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
          ? Math.round(durationMs)
          : image.durationMs,
    };
  } finally {
    release();
  }
}

export async function reprocessMetadata(image: ApiImage): Promise<ApiImage> {
  if (!image.contentType.startsWith("video/")) {
    return api.reprocessImageMetadata(image.id);
  }
  return api.saveVideoMetadata(image.id, await extractVideoMetadata(image));
}
