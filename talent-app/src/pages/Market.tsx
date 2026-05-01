import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { MarketIntelPanel, type MarketSnapshot } from '../components/MarketIntel/MarketIntelPanel'
import { useState } from 'react'

interface TalentMarketIntel {
  selfProfile:   MarketSnapshot
  peerBenchmark: MarketSnapshot
  counterparty:  MarketSnapshot
  domainNews:    MarketSnapshot
}

/* Talent /market — the live public-data view. Renders even when the
 * learner has no resume yet. Per Uday: this is what proves the platform
 * has value before they upload anything. */
export default function Market() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading } = useQuery<TalentMarketIntel>({
    queryKey: ['market-intel'],
    queryFn: () => apiFetch('/api/talent/me/market-intel'),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  async function refresh() {
    setRefreshing(true)
    try {
      const fresh = await apiFetch<TalentMarketIntel>('/api/talent/me/market-intel?refresh=true')
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
            Live data from public sources (NIRF, NAAC, naukri, linkedin, ambitionbox, glassdoor, ET, livemint, inc42). Updates daily; refresh to force.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-rule bg-white hover:bg-cloud transition-colors disabled:opacity-50"
        >
          {refreshing ? '⟳ Refreshing all…' : '⟳ Refresh all'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <MarketIntelPanel
          title="Your college's public placement record"
          subtitle="From your institution's own placement reports + NIRF data"
          data={data.selfProfile}
          accent="navy"
        />
        <MarketIntelPanel
          title="Peer learner benchmark"
          subtitle="How your tier of institutions places overall (anonymised band, not specific schools)"
          data={data.peerBenchmark}
          accent="violet"
        />
        <MarketIntelPanel
          title="Open opportunities for your track"
          subtitle="Live role counts + top hirers + salary band"
          data={data.counterparty}
          accent="teal"
        />
        <MarketIntelPanel
          title="What's happening in your domain"
          subtitle="Recent hiring news from trusted business publications"
          data={data.domainNews}
          accent="amber"
        />
      </div>

      <div className="mt-6 px-4 py-3 bg-accent-light/30 border-l-[3px] border-accent rounded text-xs text-ink leading-relaxed">
        <strong className="text-navy">This is live public data, not seeded.</strong> When you upload your resume on the
        Profile page, the AI will use this market data to recommend the career tracks where you fit best — backed by
        real demand evidence, not abstract guesses.
      </div>
    </div>
  )
}
