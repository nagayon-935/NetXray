import React, { useState } from 'react';
import { useShareLink } from '../../hooks/useShareLink';

export const ShareButton: React.FC = () => {
  const { generateShareLink } = useShareLink();
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const link = await generateShareLink();
    if (link) {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleShare}
        className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors text-xs font-medium"
      >
        Share Simulation
      </button>
      {copied && (
        <div className="absolute top-full left-0 mt-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50">
          Link copied to clipboard!
        </div>
      )}
    </div>
  );
};
