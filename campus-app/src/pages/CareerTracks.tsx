import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { CareerTrack } from '../types'

const ARCHETYPE_COLORS: Record<string, string> = {
  Product: 'bg-accent-light text-accent',
  Service: 'bg-amber-100 text-amber-800',
  MassRecruiter: 'bg-green-100 text-green-800',
}

export default function CareerTracks() {
  const navigate = useNavigate()

  const { data: tracks = [], isLoading, isError } = useQuery<CareerTrack[]>({
    queryKey: ['career-tracks'],
    queryFn: () => apiFetch('/api/campus/career-tracks'),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Career Tracks</h1>
          <p className="text-xs text-slate mt-0.5">Manage your institution's GradiumOS career tracks</p>
        </div>
        <button
          onClick={() => navigate('/career-tracks/new')}
          className="px-3.5 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
        >
          + New track
        </button>
      </div>

      {isLoading && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Loading tracks…
        </div>
      )}

      {isError && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-red-600 text-sm">
          Failed to load career tracks.
        </div>
      )}

      {!isLoading && !isError && tracks.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">⊞</div>
          <div className="text-sm font-semibold text-navy mb-1">No career tracks yet</div>
          <p className="text-xs text-slate max-w-xs mx-auto mb-4">
            Create your first career track to map your curriculum to GradiumOS clusters and start building readiness signals.
          </p>
          <button
            onClick={() => navigate('/career-tracks/new')}
            className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
          >
            Create first track
          </button>
        </div>
      )}

      {tracks.length > 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {/* v3.1.1 — Archetype column removed; tracks no longer carry a single archetype.
                    Archetype mix appears as an OUTPUT on the Gap Report once roles target the track. */}
                {['Track Name', 'Code', 'Learners', 'Created', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracks.map(t => (
                <tr
                  key={t.id}
                  className="border-b border-rule last:border-0 hover:bg-cloud/60 cursor-pointer"
                  onClick={() => navigate(`/career-tracks/${t.id}`)}
                >
                  <td className="px-4 py-3 font-semibold text-navy">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate">{t.code}</td>
                  <td className="px-4 py-3 text-ink">{t.learnerCount}</td>
                  <td className="px-4 py-3 text-slate text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/career-tracks/${t.id}`}
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
