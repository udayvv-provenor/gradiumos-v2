import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { MarketIntelPanel, type MarketSnapshot, type PeerBenchmark } from '../components/MarketIntel/MarketIntelPanel'

interface WorkforceMarketIntel {
  selfProfile:   MarketSnapshot
  peerBenchmark: PeerBenchmark
  counterparty:  MarketSnapshot
  domainNews:    MarketSnapshot
}

/* Workforce /market — live market intel for the TA. Renders even before
 * any roles are posted. Per Uday's flow: pick career tracks → see THIS
 * page → then define a role with this data in mind. */
export default function Market() {
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const { data, isLoading } = useQuery<WorkforceMarketIntel>({
    queryKey: ['market-intel'],
    queryFn: () => apiFetch('/api/workforce/me/market-intel'),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  async function refresh() {
    setRefreshing(true)
    try {
      const fresh = await apiFetch<WorkforceMarketIntel>('/api/workforce/me/market-intel?refresh=true')
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
            Live competitive + sourcing intel from public sources. Use this BEFORE you define a role — it tells you what peer employers ask for and where the talent comes from.
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="px-3 py-1.5 text-xs font-semibold rounded border border-rule bg-white hover:bg-cloud transition-colors disabled:opacity-50">
          {refreshing ? '⟳ Refreshing…' : '⟳ Refresh all'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <MarketIntelPanel
          title="Your employer's public footprint"
          subtitle="Your hiring presence + reputation snapshot from public sources (careers pages, AmbitionBox, Glassdoor)"
          data={data.selfProfile}
          accent="navy"
        />
        <MarketIntelPanel
          title="Peer competitor benchmark"
          subtitle="What peer employers in your archetype demand (anonymised aggregate — never per-competitor)"
          data={data.peerBenchmark}
          accent="violet"
        />
        <MarketIntelPanel
          title="Top sourcing institutions for this track"
          subtitle="Where your peer-archetype competitors find talent (named — these are MoU candidates)"
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
        <strong className="text-navy">Use this before posting your next role.</strong> The competitor benchmark tells you whether your asks (cluster targets, salary band, seniority) are on-market or off. The sourcing pool tells you which institutions to invite to your hiring funnel.
      </div>
    </div>
  )
}
