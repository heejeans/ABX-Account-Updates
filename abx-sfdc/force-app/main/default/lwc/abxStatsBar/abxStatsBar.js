import { LightningElement, api } from 'lwc';

export default class AbxStatsBar extends LightningElement {
    @api stats = {};
    @api activeFilter = 'Current ABX';

    get cards() {
        const s = this.stats || {};
        return [
            {
                key: 'Current ABX',
                label: 'Current ABX',
                value: s.currentABX || 0,
                isActive: this.activeFilter === 'Current ABX',
                cardClass: this.activeFilter === 'Current ABX' ? 'stat-card stat-card--active' : 'stat-card',
                iconName: 'utility:database',
            },
            {
                key: 'Add',
                label: 'Add',
                value: s.adds || 0,
                isActive: this.activeFilter === 'Add',
                cardClass: this.activeFilter === 'Add' ? 'stat-card stat-card--active stat-card--add' : 'stat-card stat-card--add',
                iconName: 'utility:add',
            },
            {
                key: 'Remove',
                label: 'Remove',
                value: s.removes || 0,
                isActive: this.activeFilter === 'Remove',
                cardClass: this.activeFilter === 'Remove' ? 'stat-card stat-card--active stat-card--remove' : 'stat-card stat-card--remove',
                iconName: 'utility:dash',
            },
            {
                key: 'Reclassify',
                label: 'Reclassify',
                value: s.reclassifies || 0,
                isActive: this.activeFilter === 'Reclassify',
                cardClass: this.activeFilter === 'Reclassify' ? 'stat-card stat-card--active stat-card--reclassify' : 'stat-card stat-card--reclassify',
                iconName: 'utility:sort',
            },
            {
                key: 'Final ABX',
                label: 'Final ABX',
                value: s.estimatedFinalABX || 0,
                isActive: this.activeFilter === 'Final ABX',
                cardClass: this.activeFilter === 'Final ABX' ? 'stat-card stat-card--active' : 'stat-card',
                iconName: 'utility:target',
            },
            {
                key: 'Unassigned AE',
                label: 'No AE',
                value: s.unassignedAE || 0,
                isActive: this.activeFilter === 'Unassigned AE',
                cardClass: this.activeFilter === 'Unassigned AE' ? 'stat-card stat-card--active stat-card--warn' : 'stat-card stat-card--warn',
                iconName: 'utility:warning',
            },
        ];
    }

    get netChangeLabel() {
        const net = this.stats?.netChange || 0;
        if (net > 0) return `+${net}`;
        if (net < 0) return String(net);
        return '0';
    }

    get netChangeClass() {
        const net = this.stats?.netChange || 0;
        if (net > 0) return 'net-change net-change--positive';
        if (net < 0) return 'net-change net-change--negative';
        return 'net-change';
    }

    get approvedLabel() {
        const count = this.stats?.approvedCount || 0;
        return count > 0 ? `${count} approved` : '';
    }

    get hasApproved() {
        return (this.stats?.approvedCount || 0) > 0;
    }

    handleCardClick(event) {
        const filter = event.currentTarget.dataset.filter;
        this.dispatchEvent(new CustomEvent('filterchange', {
            detail: { filter },
            bubbles: true,
            composed: true,
        }));
    }
}
