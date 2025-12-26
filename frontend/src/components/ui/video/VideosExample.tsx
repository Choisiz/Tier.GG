import React from "react";
import YouTubeEmbed from "./YouTubeEmbed";
import ComponentCard from "@/components/common/ComponentCard";

export default function VideosExample() {
  return (
    <div>
      <div className="grid grid-cols-1 gap-5 sm:gap-6 xl:grid-cols-2">
        <div className="space-y-5 sm:space-y-6">
          <ComponentCard title="Video Ratio 16:9">
            <YouTubeEmbed videoId="dQw4w9WgXcQ" />
          </ComponentCard>
        </div>
      </div>
    </div>
  );
}
