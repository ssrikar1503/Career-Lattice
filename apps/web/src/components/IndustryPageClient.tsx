'use client';

import { Suspense } from 'react';
import type { IndustryData } from '@/lib/types';
import CareerMap from './CareerMap';
import AgentChat from './AgentChat';

interface Props {
  data: IndustryData;
}

function MapSkeleton() {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-100 animate-pulse" style={{ height: 520 }}>
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading career map…</p>
      </div>
    </div>
  );
}

/**
 * Industry page client wrapper.
 * Wizard removed in Phase J1 to match the reference site's minimalism.
 * dolphIQ floating advisor stays (explicit client direction).
 */
export default function IndustryPageClient({ data }: Props) {
  return (
    <>
      <Suspense fallback={<MapSkeleton />}>
        <CareerMap data={data} />
      </Suspense>

      <AgentChat data={data} />
    </>
  );
}
