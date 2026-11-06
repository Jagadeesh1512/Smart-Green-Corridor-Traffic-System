/**
 * analytics.js
 * Renders real-time impact charts and updates analytics KPI indicators.
 */

class AnalyticsDashboard {
  constructor() {
    this.responseChart = null;
    this.pedestrianChart = null;
    this.initCharts();
  }

  initCharts() {
    // 1. Emergency Response Time Comparison Chart
    const ctxResponse = document.getElementById('responseChart');
    if (ctxResponse && window.Chart) {
      this.responseChart = new Chart(ctxResponse, {
        type: 'bar',
        data: {
          labels: ['Run 91', 'Run 92', 'Run 93', 'Run 94', 'Run 95'],
          datasets: [
            {
              label: 'Standard Traffic (No Corridor)',
              data: [142, 138, 155, 146, 135],
              backgroundColor: 'rgba(239, 68, 68, 0.45)',
              borderColor: '#ef4444',
              borderWidth: 1.5,
              borderRadius: 4
            },
            {
              label: 'Green-Corridor Priority',
              data: [61, 58, 66, 62, 59],
              backgroundColor: 'rgba(34, 197, 94, 0.65)',
              borderColor: '#22c55e',
              borderWidth: 1.5,
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#94a3b8', font: { size: 11, family: 'Inter' } }
            },
            tooltip: {
              callbacks: {
                footer: (items) => {
                  const baseline = items[0].parsed.y;
                  const corridor = items[1] ? items[1].parsed.y : items[0].parsed.y;
                  const diff = Math.abs(baseline - corridor);
                  return `Time Saved: ~${diff} seconds`;
                }
              }
            }
          },
          scales: {
            x: {
              ticks: { color: '#64748b', font: { size: 10 } },
              grid: { color: 'rgba(255,255,255,0.05)' }
            },
            y: {
              title: { display: true, text: 'Trip Duration (Seconds)', color: '#94a3b8', font: { size: 10 } },
              ticks: { color: '#64748b', font: { size: 10 } },
              grid: { color: 'rgba(255,255,255,0.05)' }
            }
          }
        }
      });
    }

    // 2. Pedestrian Safety Distribution Chart
    const ctxPed = document.getElementById('pedestrianChart');
    if (ctxPed && window.Chart) {
      this.pedestrianChart = new Chart(ctxPed, {
        type: 'doughnut',
        data: {
          labels: ['Standard Crossings (10s)', 'Elderly Dynamic Assist (+14s)', 'Ultrasonic Radar Holds (+5s)'],
          datasets: [{
            data: [65, 28, 7],
            backgroundColor: [
              'rgba(59, 130, 246, 0.75)',
              'rgba(245, 158, 11, 0.85)',
              'rgba(16, 185, 129, 0.85)'
            ],
            borderColor: '#111827',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#94a3b8', font: { size: 10, family: 'Inter' } }
            }
          },
          cutout: '70%'
        }
      });
    }
  }

  updateMetrics(analytics) {
    if (!analytics) return;

    // Update KPIs in the UI
    const elReduction = document.getElementById('kpiReductionPercent');
    if (elReduction) {
      elReduction.textContent = `${analytics.averageReductionPercent}%`;
    }

    const elTimeSaved = document.getElementById('kpiTimeSaved');
    if (elTimeSaved) {
      elTimeSaved.textContent = `${analytics.totalSecondsSaved}s`;
    }

    const elTotalRuns = document.getElementById('kpiTotalRuns');
    if (elTotalRuns) {
      elTotalRuns.textContent = analytics.totalEmergencyRuns;
    }

    const elElderlyAssists = document.getElementById('kpiElderlyAssists');
    if (elElderlyAssists && analytics.pedestrianMetrics) {
      elElderlyAssists.textContent = analytics.pedestrianMetrics.elderlyAssists;
    }

    const elExtraSec = document.getElementById('kpiExtraSeconds');
    if (elExtraSec && analytics.pedestrianMetrics) {
      elExtraSec.textContent = `+${analytics.pedestrianMetrics.totalExtraSecondsGranted}s`;
    }

    // Update Response Time Chart with new historical dispatches
    if (this.responseChart && analytics.historicalDispatches && analytics.historicalDispatches.length > 0) {
      const recent = analytics.historicalDispatches.slice(-6);
      this.responseChart.data.labels = recent.map(r => r.id.split('-').slice(-2).join('-'));
      this.responseChart.data.datasets[0].data = recent.map(r => r.baselineSeconds);
      this.responseChart.data.datasets[1].data = recent.map(r => r.corridorSeconds);
      this.responseChart.update('none');
    }

    // Update Pedestrian Safety Chart
    if (this.pedestrianChart && analytics.pedestrianMetrics) {
      const p = analytics.pedestrianMetrics;
      const std = Math.max(1, p.standardCrossings);
      const eld = Math.max(1, p.elderlyAssists);
      const holds = Math.max(0, p.safetyHoldsTriggered);
      this.pedestrianChart.data.datasets[0].data = [std, eld, holds];
      this.pedestrianChart.update('none');
    }

    // Render Event Logs
    this.renderEventLogs(analytics.recentLogs);
  }

  renderEventLogs(logs) {
    const container = document.getElementById('eventLogsContainer');
    if (!container || !logs) return;

    container.innerHTML = logs.slice(0, 15).map(log => {
      let badgeClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      if (log.severity === 'danger') badgeClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      if (log.severity === 'success') badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      if (log.severity === 'warning') badgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';

      return `
        <div class="p-2.5 rounded-lg border text-xs flex items-start gap-3 ${badgeClass} transition hover:bg-white/5">
          <span class="font-mono text-gray-500 whitespace-nowrap text-[10px] mt-0.5">${log.timestamp}</span>
          <div class="flex-1">
            <div class="font-semibold text-gray-200">${log.title}</div>
            <div class="text-gray-400 text-[11px] mt-0.5">${log.detail}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

window.AnalyticsDashboard = AnalyticsDashboard;
