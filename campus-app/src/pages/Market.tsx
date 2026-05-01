import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { MarketIntelPanel, type MarketSnapshot } from '../components/MarketIntel/MarketIntelPanel'

interface CampusMarketIntel {
  selfProfile:   MarketSnapshot
  peerBenchmark: MarketSnapshot
  counterparty:  MarketSnapshot
  domainNews:    MarketSnapshot
}

/* Campus /market — live institution + sector intel for the Dean. Renders
 * before any curriculum is uploaded. Per Uday's flow: pick career tracks
 * → see THIS page → then upload curriculum with full context. */
export default function Market() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading } = useQuery<CampusMarketIntel>({
    queryKey: ['market-intel'],
    queryFn: () => apiFetch('/api/campus/me/market-intel'),
  } as any)

  async function refresh() {
    setRefreshing(true)
    try {
      const fresh = await apiFetch<CampusMarketIntel>('/api/campus/me/market-intel?refresh=true')
      qc.setQueryData(['market-intel'], fresh)
      showToast('Market intel refreshed', 'success')
    } catch (e) { showToast(e instanceof Error ? e.message : 'Refresh failed') }
    finally { setRefreshing(false) }
  }

  if (isLoading) return <div className="text-slate text-sm p-4">Loading live market intel…</div>
  if (!data)     return <div className="text-red-600 text-sm p-4">Couldn't load market intel.</div>

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Market Intelligence</h1>
          <p className="text-xs text-slate mt-0.5 max-w-2xl leading-relaxed">
            Live institution + sector intel from public sources (NIRF, NAAC, AISHE, ET, livemint, inc42). Use this BEFORE you upload curriculum — it tells you what industry actually demands and which employers hire from your peer institutions.
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="px-3 py-1.5 text-xs font-semibold rounded border border-rule bg-white hover:bg-cloud transition-colors disabled:opacity-50">
          {refreshing ? '⟳ Refreshing…' : '⟳ Refresh all'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <MarketIntelPanel
          title="Your institution's public profile"
          subtitle="From NIRF + NAAC official records"
          data={data.selfProfile}
          accent="navy"
        />
        <MarketIntelPanel
          title="Peer placement benchmark"
          subtitle="How peer-tier institutions place overall (anonymised band, never browseable list — per IP rules)"
          data={data.peerBenchmark}
          accent="violet"
        />
        <MarketIntelPanel
          title="Top hirers from your peer institutions"
          subtitle="Companies actively recruiting from your archetype-peer institutions — these are MoU candidates"
          data={data.counterparty}
          accent="teal"
        />
        <MarketIntelPanel
          title="What's happening in your sector"
          subtitle="Recent hiring news from trusted business publications"
          data={data.domainNews}
          accent="amber"
        />
      </div>

      <div className="mt-6 px-4 py-3 bg-accent-light/30 border-l-[3px] border-accent rounded text-xs text-ink leading-relaxed">
        <strong className="text-navy">Use this BEFORE you upload curriculum.</strong> Once you upload curriculum, the gap report compares your coverage against the demand signal aggregated from employers active on the platform — but the public-data view shown above gives you a SECOND signal grounded in the open market.
      </div>
    </div>
  )
}
