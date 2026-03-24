import { LightningElement, api, track } from 'lwc';

// filterType: 'picklist' (checkboxes), 'number' (operator + value), 'text' (operator + value)
const FIELD_CONFIGS = [
    { key: 'intent', label: 'Account Intent', field: 'intent', filterType: 'picklist', order: ['High', 'Medium', 'Low', 'None'] },
    { key: 'stage', label: 'Account Stage', field: 'stage', filterType: 'picklist' },
    { key: 'segment', label: 'Sales Segment', field: 'segment', filterType: 'picklist' },
    { key: 'fitScore', label: 'Fit Score Total', field: 'fitScore', filterType: 'number' },
    { key: 'currentTier', label: 'ABX Tier', field: 'currentTier', filterType: 'picklist', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'dnn', label: 'Marketplace Prospect', field: null, filterType: 'picklist' },
    { key: 'aeTerritory', label: 'AE Territory', field: 'aeTerritory', filterType: 'picklist' },
    { key: 'accountExecutive', label: 'Account Executive Owner', field: 'accountExecutiveName', filterType: 'text' },
    { key: 'accountDevOwner', label: 'Account Development Owner', field: 'accountDevOwnerName', filterType: 'text' },
    { key: 'aeStatus', label: 'AE Assigned', field: null, filterType: 'picklist' },
];

const NUMBER_OPERATORS = [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equal to' },
    { value: 'lt', label: 'less than' },
    { value: 'gt', label: 'greater than' },
    { value: 'lte', label: 'less or equal' },
    { value: 'gte', label: 'greater or equal' },
    { value: 'between', label: 'between' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
];

const TEXT_OPERATORS = [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equal' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
];

function matchesOperatorFilter(val, filter, filterType) {
    const op = filter.operator;
    if (op === 'empty') return val == null || val === '' || val === 'None';
    if (op === 'notEmpty') return val != null && val !== '' && val !== 'None';

    if (filterType === 'number') {
        const numVal = (val != null) ? Number(val) : null;
        if (op === 'eq') {
            const targets = String(filter.value).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
            return numVal != null && targets.includes(numVal);
        }
        if (op === 'neq') {
            const targets = String(filter.value).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
            return numVal != null && !targets.includes(numVal);
        }
        const fv = Number(filter.value);
        if (numVal == null || isNaN(numVal)) return false;
        if (op === 'lt') return numVal < fv;
        if (op === 'gt') return numVal > fv;
        if (op === 'lte') return numVal <= fv;
        if (op === 'gte') return numVal >= fv;
        if (op === 'between') {
            const fv2 = Number(filter.value2);
            return numVal >= fv && numVal <= fv2;
        }
    } else {
        const strVal = val != null ? String(val).toLowerCase() : '';
        const fv = filter.value ? filter.value.toLowerCase() : '';
        if (op === 'eq') return strVal === fv;
        if (op === 'neq') return strVal !== fv;
        if (op === 'contains') return strVal.includes(fv);
        if (op === 'notContains') return !strVal.includes(fv);
    }
    return true;
}

function getFieldValue(account, config) {
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
        const rows = [];
        const seenIds = new Set();

        // 1. Process all accounts from the review data
        for (const a of this.accounts) {
            if (a.action === 'Ignore') continue;
            seenIds.add(a.id);
            const inCampaign = ms.has(a.id);
            const tier = effectiveTier(a, this.approvedIds, this.rejectedIds);
            const inFinalABX = !!tier;
            let syncStatus;
            if (inCampaign && inFinalABX) syncStatus = 'synced';
            else if (!inCampaign && inFinalABX) syncStatus = 'needs-add';
            else if (inCampaign && !inFinalABX) syncStatus = 'needs-remove';
            else continue;
            rows.push({ ...a, inCampaign, inFinalABX, syncStatus, effectiveTier: tier });
        }

        // 2. Campaign members NOT in the review data — these are in the campaign
        //    but have no tier / don't qualify, so they need to be removed.
        if (this.campaignData?.members) {
            for (const m of this.campaignData.members) {
                if (seenIds.has(m.accountId)) continue;
                rows.push({
                    id: m.accountId,
                    name: m.accountName || m.accountId,
                    inCampaign: true,
                    inFinalABX: false,
                    syncStatus: 'needs-remove',
                    effectiveTier: null,
                    currentTier: null,
                    recommendedTier: null,
                    action: 'Remove',
                    intent: null,
                    stage: null,
                    isDnn: false,
                    fitScore: null,
                    segment: null,
                    aeTerritory: null,
                    accountExecutiveName: null,
                    accountDevOwnerName: null,
                });
            }
        }

        return rows;
    }

    // ─── Computed: stats ──────────────────────────────────────────────────────

    get syncStats() {
        const rows = this.allRows;
        // "In Campaign" = actual campaign member count from server
        const inCampaign = this.campaignData?.memberCount || 0;
        return {
            total: rows.length,
            synced: rows.filter(r => r.syncStatus === 'synced').length,
            toAdd: rows.filter(r => r.syncStatus === 'needs-add').length,
            toRemove: rows.filter(r => r.syncStatus === 'needs-remove').length,
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
            base = base.filter(r => r.syncStatus === this.filter);
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
            if (!selected) continue;
            const ft = config.filterType || 'picklist';

            if (selected.operator) {
                base = base.filter(a => {
                    const val = ft === 'number' ? a[config.field] : getFieldValue(a, config);
                    return matchesOperatorFilter(val, selected, ft);
                });
            } else if (selected.size > 0) {
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
            isActionable: this.filter !== 'in-campaign' && r.syncStatus !== 'synced'
                && !this.cpApprovedIds.has(r.id) && !this.cpRejectedIds.has(r.id),
            rowClass: 'slds-box slds-m-bottom_xx-small account-card'
                + (this.cpApprovedIds.has(r.id) ? ' account-card_approved' : '')
                + (this.cpRejectedIds.has(r.id) ? ' account-card_rejected' : ''),
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
            const f = this.fieldFilters[key];
            if (!f) continue;
            if (f.operator) { count++; continue; }
            if (f.size > 0) count++;
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
            const isActive = this.activeFilterCategory === config.key;
            const ft = config.filterType || 'picklist';

            // Operator-based filters (number / text)
            if (ft === 'number' || ft === 'text') {
                const filter = this.fieldFilters[config.key];
                return {
                    key: config.key,
                    label: config.label,
                    filterType: ft,
                    isActive,
                    catClass: isActive ? 'filter-cat filter-cat--active' : 'filter-cat',
                    hasSelections: !!filter,
                    values: [],
                };
            }

            // Picklist checkbox filters
            const valueCounts = new Map();
            accounts.forEach(a => {
                const val = getFieldValue(a, config);
                valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
            });
            if (valueCounts.size <= 1) return null;

            let sortedValues;
            if (config.order) {
                sortedValues = config.order.filter(v => valueCounts.has(v));
            } else {
                sortedValues = [...valueCounts.keys()].sort();
            }

            // Always include an "(Empty)" option
            const emptyKey = config.emptyLabel || 'None';
            if (!valueCounts.has(emptyKey)) {
                sortedValues.push(emptyKey);
                valueCounts.set(emptyKey, 0);
            }

            const selected = this.fieldFilters[config.key] || new Set();
            return {
                key: config.key,
                label: config.label,
                filterType: 'picklist',
                isActive,
                catClass: isActive ? 'filter-cat filter-cat--active' : 'filter-cat',
                hasSelections: selected.size > 0,
                values: sortedValues.map(v => ({
                    value: v,
                    label: v,
                    checked: selected.has(v),
                    count: valueCounts.get(v) || 0,
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

    get activeFilterType() {
        if (!this.activeFilterCategory) return 'picklist';
        const cat = this.filterCategories.find(c => c.key === this.activeFilterCategory);
        return cat ? cat.filterType : 'picklist';
    }

    get isActiveFilterPicklist() { return this.activeFilterType === 'picklist'; }
    get isActiveFilterNumber()   { return this.activeFilterType === 'number'; }
    get isActiveFilterText()     { return this.activeFilterType === 'text'; }

    get activeFilterOperators() {
        const ops = this.activeFilterType === 'number' ? NUMBER_OPERATORS : TEXT_OPERATORS;
        const current = this.activeFilterOperator;
        return ops.map(op => ({ ...op, selected: op.value === current }));
    }

    get activeFilterOperator() {
        const f = this.fieldFilters[this.activeFilterCategory];
        return f && f.operator ? f.operator : 'eq';
    }

    get activeFilterValue() {
        const f = this.fieldFilters[this.activeFilterCategory];
        return f && f.value != null ? f.value : '';
    }

    get activeFilterValue2() {
        const f = this.fieldFilters[this.activeFilterCategory];
        return f && f.value2 != null ? f.value2 : '';
    }

    get isActiveOperatorBetween() {
        return this.activeFilterOperator === 'between';
    }

    get isActiveOperatorNeedsValue() {
        const op = this.activeFilterOperator;
        return op !== 'empty' && op !== 'notEmpty';
    }

    handleFilterOperatorChange(event) {
        const key = this.activeFilterCategory;
        const op = event.target.value;
        const newFilters = { ...this.fieldFilters };
        const current = newFilters[key] || {};
        if (op === 'empty' || op === 'notEmpty') {
            newFilters[key] = { operator: op };
        } else {
            newFilters[key] = { operator: op, value: current.value || '', value2: current.value2 || '' };
        }
        this.fieldFilters = newFilters;
    }

    handleFilterValueInput(event) {
        const key = this.activeFilterCategory;
        const which = event.currentTarget.dataset.which || 'value';
        const raw = event.target.value;
        const newFilters = { ...this.fieldFilters };
        const current = newFilters[key] || { operator: 'eq' };
        newFilters[key] = { ...current, [which]: raw };
        const op = newFilters[key].operator;
        if (op !== 'empty' && op !== 'notEmpty' && !newFilters[key].value && !newFilters[key].value2) {
            delete newFilters[key];
        }
        this.fieldFilters = newFilters;
    }

    handleClearOperatorFilter() {
        const key = this.activeFilterCategory;
        const newFilters = { ...this.fieldFilters };
        delete newFilters[key];
        this.fieldFilters = newFilters;
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
