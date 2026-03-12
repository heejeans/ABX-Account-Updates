import { LightningElement, api } from 'lwc';

const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'];

export default class AbxStatsBar extends LightningElement {
    @api stats = {};
    @api tierDistribution = { current: {}, final: {} };
    @api activeFilter = 'Current ABX';

    get cards() {
        const s = this.stats || {};
        const items = [
            { key: 'Current ABX', label: 'Current ABX', value: s.currentABX || 0 },
            { key: 'Add', label: 'Add', value: s.adds || 0 },
            { key: 'Remove', label: 'Remove', value: s.removes || 0 },
            { key: 'Reclassify', label: 'Reclassify', value: s.reclassifies || 0 },
            { key: 'Unassigned AE', label: 'No AE', value: s.unassignedAE || 0 },
            { key: 'Final ABX', label: 'Final ABX', value: s.estimatedFinalABX || 0 },
        ];
        return items.map(item => ({
            ...item,
            isActive: this.activeFilter === item.key,
            cellClass: this.activeFilter === item.key
                ? 'stats-table__cell stats-table__cell--active'
                : 'stats-table__cell',
        }));
    }

    // ─── Tier distribution chart ───────────────────────────────────────────────

    get hasTierData() {
        const d = this.tierDistribution;
        if (!d || !d.current) return false;
        return TIERS.some(t => (d.current[t] || 0) > 0 || (d.final[t] || 0) > 0);
    }

    get chartBars() {
        const d = this.tierDistribution || { current: {}, final: {} };
        let maxVal = 1;
        TIERS.forEach(t => {
            maxVal = Math.max(maxVal, d.current[t] || 0, d.final[t] || 0);
        });

        return TIERS.map(tier => {
            const currentCount = d.current[tier] || 0;
            const finalCount = d.final[tier] || 0;
            const currentPct = Math.round((currentCount / maxVal) * 100);
            const finalPct = Math.round((finalCount / maxVal) * 100);
            return {
                tier,
                currentCount,
                finalCount,
                currentStyle: `width: ${Math.max(currentPct, 2)}%`,
                finalStyle: `width: ${Math.max(finalPct, 2)}%`,
                changed: currentCount !== finalCount,
            };
        });
    }

    // ─── Event dispatch ────────────────────────────────────────────────────────

    handleCardClick(event) {
        const filter = event.currentTarget.dataset.filter;
        this.dispatchEvent(new CustomEvent('filterchange', {
            detail: { filter },
            bubbles: true,
            composed: true,
        }));
    }
}
