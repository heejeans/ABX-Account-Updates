import { LightningElement, api, track } from 'lwc';

// Field filter configs for campaign sync (same as Review tab)
const FIELD_CONFIGS = [
    { key: 'intent', label: 'Account Intent', field: 'intent', order: ['High', 'Medium', 'Low', 'None'] },
    { key: 'stage', label: 'Account Stage', field: 'stage' },
    { key: 'segment', label: 'Sales Segment', field: 'segment' },
    { key: 'fitBucket', label: 'Fit Score Total', field: null },
    { key: 'currentTier', label: 'ABX Tier', field: 'currentTier', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'dnn', label: 'Marketplace Prospect', field: null },
    { key: 'aeTerritory', label: 'AE Territory', field: 'aeTerritory' },
    { key: 'accountExecutive', label: 'Account Executive Owner', field: 'accountExecutiveName' },
    { key: 'accountDevOwner', label: 'Account Development Owner', field: 'accountDevOwnerName' },
    { key: 'aeStatus', label: 'AE Assigned', field: null },
];

function getFitBucket(fitScore) {
    if (fitScore == null) return 'No Score';
    if (fitScore >= 9) return '9+ (High)';
    if (fitScore >= 5) return '5-8 (Med)';
    return '< 5 (Low)';
}

function getFieldValue(account, config) {
    if (config.key === 'fitBucket') return getFitBucket(account.fitScore);
    if (config.key === 'dnn') return account.isDnn ? 'DNN' : 'Non-DNN';
    if (config.key === 'aeStatus') return account.accountExecutiveName ? 'Assigned' : 'Unassigned';
    if (config.key === 'currentTier') return account.currentTier || 'No Tier';
    return account[config.field] || 'None';
}

// Compute effective tier after a review decision
function effectiveTier(account, approvedIds, rejectedIds) {
    if (approvedIds.has(account.id)) {
        if (account.action === 'Remove') return null;
        return account.recommendedTier || null;
    }
    return account.currentTier || null;
}

export default class AbxCampaignSync extends LightningElement {
    @api accounts = [];
    @api campaignData = null;
    @api approvedIds = new Set();
    @api rejectedIds = new Set();
    @api cpApprovedIds = new Set();
    @api cpRejectedIds = new Set();

    @track searchTerm = '';
    @track filter = 'in-campaign';   // default to "Currently in Campaign"
    @track selectedIds = new Set();
    @track fieldFilters = {};
    @track filterPanelOpen = false;
    @track activeFilterCategory = null;

    // ─── Computed: campaign member set ────────────────────────────────────────

    get memberSet() {
        if (!this.campaignData?.members) return new Set();
        return new Set(this.campaignData.members.map(m => m.accountId));
    }

    // ─── Computed: rows with sync status ─────────────────────────────────────

    get allRows() {
        const ms = this.memberSet;
        return this.accounts
            .filter(a => a.action !== 'Ignore')
            .map(a => {
                const inCampaign = ms.has(a.id);
                const tier = effectiveTier(a, this.approvedIds, this.rejectedIds);
                const inFinalABX = !!tier;
                let syncStatus;
                if (inCampaign && inFinalABX) syncStatus = 'synced';
                else if (!inCampaign && inFinalABX) syncStatus = 'needs-add';
                else if (inCampaign && !inFinalABX) syncStatus = 'needs-remove';
                else return null;
                return { ...a, inCampaign, inFinalABX, syncStatus, effectiveTier: tier };
            })
            .filter(Boolean);
    }

    // ─── Computed: stats ──────────────────────────────────────────────────────

    get syncStats() {
        const rows = this.allRows;
        // "In Campaign" = actual campaign member count from server
        const inCampaign = this.campaignData?.memberCount || 0;
        return {
            total: rows.length,
            synced: rows.filter(r => r.syncStatus === 'synced').length,
            toAdd: rows.filter(r => r.syncStatus === 'needs-add' && !this.cpApprovedIds.has(r.id)).length,
            toRemove: rows.filter(r => r.syncStatus === 'needs-remove' && !this.cpApprovedIds.has(r.id)).length,
            inCampaign,
        };
    }

    // ─── Stat Cards (matches Review tab style) ──────────────────────────────

    get statCards() {
        const s = this.syncStats;
        const items = [
            { key: 'in-campaign', label: 'In Campaign', value: s.inCampaign },
            { key: 'needs-remove', label: 'Remove', value: s.toRemove },
            { key: 'needs-add', label: 'Add', value: s.toAdd },
        ];
        return items.map(item => ({
            ...item,
            isActive: this.filter === item.key,
            cellClass: this.filter === item.key
                ? 'stats-table__cell stats-table__cell--active'
                : 'stats-table__cell',
        }));
    }

    handleCardClick(event) {
        this.filter = event.currentTarget.dataset.filter;
        this.selectedIds = new Set();
    }

    // ─── Computed: filtered rows ──────────────────────────────────────────────

    get baseFilteredRows() {
        let base = this.allRows;

        if (this.filter === 'in-campaign') {
            base = base.filter(r => r.inCampaign && !(this.cpApprovedIds.has(r.id) && r.syncStatus === 'needs-remove'));
        } else if (this.filter === 'needs-add' || this.filter === 'needs-remove') {
            base = base.filter(r => r.syncStatus === this.filter && !this.cpApprovedIds.has(r.id) && !this.cpRejectedIds.has(r.id));
        } else {
            base = base.filter(r => r.syncStatus !== 'synced');
        }

        return base;
    }

    get filteredRows() {
        let base = this.baseFilteredRows;

        // Apply field filters
        const activeFilters = this.fieldFilters;
        for (const config of FIELD_CONFIGS) {
            const selected = activeFilters[config.key];
            if (selected && selected.size > 0) {
                base = base.filter(a => selected.has(getFieldValue(a, config)));
            }
        }

        // Search
        if (this.searchTerm) {
            const q = this.searchTerm.toLowerCase();
            base = base.filter(r => r.name?.toLowerCase().includes(q));
        }

        return base;
    }

    get displayRows() {
        return this.filteredRows.map(r => ({
            ...r,
            accountUrl: `/lightning/r/Account/${r.id}/view`,
            fitScoreDisplay: r.fitScore != null ? String(r.fitScore) : '—',
            intentDisplay: r.intent || '—',
            stageDisplay: r.stage || '—',
            dnnDisplay: r.isDnn ? 'Yes' : 'No',
            aeTerritoryDisplay: r.aeTerritory || null,
            accountExecutiveName: r.accountExecutiveName || null,
            accountDevOwnerName: r.accountDevOwnerName || null,
            hasAE: !!r.accountExecutiveName,
            isCpApproved: this.cpApprovedIds.has(r.id),
            isCpRejected: this.cpRejectedIds.has(r.id),
            isSelected: this.selectedIds.has(r.id),
            isActionable: this.filter !== 'in-campaign' && r.syncStatus !== 'synced' && !this.cpApprovedIds.has(r.id),
            syncLabel: r.syncStatus === 'needs-add' ? 'Add to Campaign' :
                       r.syncStatus === 'needs-remove' ? 'Remove from Campaign' : 'Synced',
            syncBadgeClass: r.syncStatus === 'needs-add' ? 'slds-badge slds-theme_success' :
                            r.syncStatus === 'needs-remove' ? 'slds-badge slds-theme_error' :
                            'slds-badge',
            syncDescription: r.syncStatus === 'needs-add'
                ? `Add to campaign — this account has ${r.effectiveTier} but is not yet a campaign member.`
                : r.syncStatus === 'needs-remove'
                    ? 'Remove from campaign — this account is a campaign member but has no current tier.'
                    : 'No change needed — already synced.',
        }));
    }

    get filteredCount() {
        return this.filteredRows.length;
    }

    // ─── Field Filter Logic ───────────────────────────────────────────────────

    get activeFieldFilterCount() {
        let count = 0;
        for (const key of Object.keys(this.fieldFilters)) {
            if (this.fieldFilters[key] && this.fieldFilters[key].size > 0) count++;
        }
        return count;
    }

    get hasActiveFieldFilters() {
        return this.activeFieldFilterCount > 0;
    }

    get filterButtonLabel() {
        const count = this.activeFieldFilterCount;
        return count > 0 ? `Filters (${count})` : 'Filters';
    }

    get filterButtonVariant() {
        return this.hasActiveFieldFilters ? 'brand' : 'neutral';
    }

    get filterCategories() {
        const accounts = this.baseFilteredRows;
        return FIELD_CONFIGS.map(config => {
            const values = new Set();
            accounts.forEach(a => values.add(getFieldValue(a, config)));
            if (values.size <= 1) return null;

            let sortedValues;
            if (config.order) {
                sortedValues = config.order.filter(v => values.has(v));
            } else {
                sortedValues = [...values].sort();
            }

            const selected = this.fieldFilters[config.key] || new Set();
            return {
                key: config.key,
                label: config.label,
                isActive: this.activeFilterCategory === config.key,
                catClass: this.activeFilterCategory === config.key
                    ? 'filter-cat filter-cat--active' : 'filter-cat',
                hasSelections: selected.size > 0,
                values: sortedValues.map(v => ({
                    value: v,
                    label: v,
                    checked: selected.has(v),
                    count: accounts.filter(a => getFieldValue(a, config) === v).length,
                })),
            };
        }).filter(Boolean);
    }

    handleToggleFilterPanel() {
        this.filterPanelOpen = !this.filterPanelOpen;
        if (this.filterPanelOpen && !this.activeFilterCategory && this.filterCategories.length > 0) {
            this.activeFilterCategory = this.filterCategories[0].key;
        }
    }

    handleFilterCategoryClick(event) {
        this.activeFilterCategory = event.currentTarget.dataset.key;
    }

    handleFilterValueToggle(event) {
        const key = this.activeFilterCategory;
        const value = event.currentTarget.dataset.value;
        const newFilters = { ...this.fieldFilters };
        const current = new Set(newFilters[key] || []);

        if (current.has(value)) {
            current.delete(value);
        } else {
            current.add(value);
        }

        if (current.size === 0) {
            delete newFilters[key];
        } else {
            newFilters[key] = current;
        }
        this.fieldFilters = newFilters;
    }

    handleClearFieldFilters() {
        this.fieldFilters = {};
    }

    get activeFilterValues() {
        if (!this.activeFilterCategory) return [];
        const cat = this.filterCategories.find(c => c.key === this.activeFilterCategory);
        return cat ? cat.values : [];
    }

    get isActionableView() {
        return this.filter !== 'in-campaign';
    }

    // ─── Search ───────────────────────────────────────────────────────────────

    handleSearchChange(event) {
        this.searchTerm = event.target.value;
    }

    // ─── Approve / Reject ─────────────────────────────────────────────────────

    handleApprove(event) {
        const accountId = event.currentTarget.dataset.id;
        this.dispatchEvent(new CustomEvent('cpapprove', {
            detail: { accountId },
            bubbles: true,
            composed: true,
        }));
    }

    handleReject(event) {
        const accountId = event.currentTarget.dataset.id;
        this.dispatchEvent(new CustomEvent('cpreject', {
            detail: { accountId },
            bubbles: true,
            composed: true,
        }));
    }

    // ─── Select / Bulk ────────────────────────────────────────────────────────

    handleToggleSelect(event) {
        const id = event.currentTarget.dataset.id;
        const newSel = new Set(this.selectedIds);
        if (newSel.has(id)) newSel.delete(id);
        else newSel.add(id);
        this.selectedIds = newSel;
    }

    get actionableVisible() {
        return this.filteredRows.filter(r => r.syncStatus !== 'synced' && !this.cpApprovedIds.has(r.id));
    }

    get allSelected() {
        const av = this.actionableVisible;
        return av.length > 0 && av.every(r => this.selectedIds.has(r.id));
    }

    get hasSelection() {
        return this.selectedIds.size > 0;
    }

    get selectedCount() {
        return this.selectedIds.size;
    }

    handleSelectAll() {
        if (this.allSelected) {
            this.selectedIds = new Set();
        } else {
            this.selectedIds = new Set(this.actionableVisible.map(r => r.id));
        }
    }

    handleApproveSelected() {
        this.selectedIds.forEach(id => {
            this.dispatchEvent(new CustomEvent('cpapprove', {
                detail: { accountId: id },
                bubbles: true,
                composed: true,
            }));
        });
        this.selectedIds = new Set();
    }

    handleRejectSelected() {
        this.selectedIds.forEach(id => {
            this.dispatchEvent(new CustomEvent('cpreject', {
                detail: { accountId: id },
                bubbles: true,
                composed: true,
            }));
        });
        this.selectedIds = new Set();
    }

    // ─── Sync to Salesforce ───────────────────────────────────────────────────

    get hasCpApproved() {
        return this.cpApprovedIds.size > 0;
    }

    get syncButtonLabel() {
        return `Sync ${this.cpApprovedIds.size} Changes`;
    }

    handleSync() {
        const changes = this.allRows
            .filter(r => this.cpApprovedIds.has(r.id) && r.syncStatus !== 'synced')
            .map(r => ({
                accountId: r.id,
                action: r.syncStatus === 'needs-add' ? 'Add' : 'Remove',
                tier: null,
            }));

        this.dispatchEvent(new CustomEvent('cpsync', {
            detail: { changes },
            bubbles: true,
            composed: true,
        }));
    }

    // ─── Campaign info ────────────────────────────────────────────────────────

    get campaignName() {
        return this.campaignData?.campaignName || 'ABX Campaign';
    }

    get campaignMemberCount() {
        return this.campaignData?.memberCount || 0;
    }

    get hasCampaignData() {
        return !!this.campaignData;
    }

    get campaignUrl() {
        if (!this.campaignData?.campaignId) return '#';
        return `https://cloudzero.lightning.force.com/${this.campaignData.campaignId}`;
    }

    // ─── Row expansion ────────────────────────────────────────────────────────

    handleToggleExpand(event) {
        const id = event.currentTarget.dataset.id;
        const el = this.template.querySelector(`[data-detail-id="${id}"]`);
        if (el) el.classList.toggle('slds-hide');
    }

    // ─── Close filter panel on outside click ──────────────────────────────────

    handleBodyClick(event) {
        if (this.filterPanelOpen) {
            const path = event.composedPath();
            const panel = this.template.querySelector('.filter-panel');
            const btn = this.template.querySelector('.filter-toggle-btn');
            const clickedPanel = panel && path.includes(panel);
            const clickedBtn = btn && path.includes(btn);
            if (!clickedPanel && !clickedBtn) {
                this.filterPanelOpen = false;
            }
        }
    }

    connectedCallback() {
        this._bodyClickHandler = this.handleBodyClick.bind(this);
        document.addEventListener('click', this._bodyClickHandler);
    }

    disconnectedCallback() {
        document.removeEventListener('click', this._bodyClickHandler);
    }
}
