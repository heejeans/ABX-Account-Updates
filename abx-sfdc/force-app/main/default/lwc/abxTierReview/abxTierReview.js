import { LightningElement, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getAccountReviewData from '@salesforce/apex/ABXTierReviewController.getAccountReviewData';
import getCampaignSyncData from '@salesforce/apex/ABXTierReviewController.getCampaignSyncData';
import applyTierChanges from '@salesforce/apex/ABXTierReviewController.applyTierChanges';
import syncCampaignMembership from '@salesforce/apex/ABXTierReviewController.syncCampaignMembership';
import getAEUsers from '@salesforce/apex/ABXTierReviewController.getAEUsers';
import assignAccountExecutives from '@salesforce/apex/ABXTierReviewController.assignAccountExecutives';
import getAccountFieldDescribe from '@salesforce/apex/ABXTierReviewController.getAccountFieldDescribe';
import getDynamicFieldValues from '@salesforce/apex/ABXTierReviewController.getDynamicFieldValues';

// Action badge CSS classes
const ACTION_CLASSES = {
    'Add': 'slds-badge slds-theme_success',
    'Remove': 'slds-badge slds-theme_error',
    'Reclassify': 'slds-badge slds-theme_warning',
    'No Change': 'slds-badge slds-theme_default',
    'Ignore': 'slds-badge',
};

// Field filter category definitions (mirrors React FieldFilters FIELD_CONFIGS)
const FIELD_CONFIGS = [
    { key: 'intent', label: 'Account Intent', field: 'intent', order: ['High', 'Medium', 'Low', 'None'] },
    { key: 'stage', label: 'Account Stage', field: 'stage' },
    { key: 'segment', label: 'Sales Segment', field: 'segment' },
    { key: 'fitBucket', label: 'Fit Score Total', field: null },  // special bucketing
    { key: 'currentTier', label: 'ABX Tier', field: 'currentTier', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'recommendedTier', label: 'Projected Tier', field: 'recommendedTier', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'dnn', label: 'Marketplace Prospect', field: null },  // special boolean
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

function getFieldValue(account, config, dynamicFieldValues) {
    if (config.key === 'fitBucket') return getFitBucket(account.fitScore);
    if (config.key === 'dnn') return account.isDnn ? 'DNN' : 'Non-DNN';
    if (config.key === 'aeStatus') return account.accountExecutiveName ? 'Assigned' : 'Unassigned';
    if (config.key === 'currentTier') return account.currentTier || 'No Tier';
    if (config.key === 'recommendedTier') return account.recommendedTier || 'No Tier';
    // Dynamic field lookup
    if (config.isDynamic && dynamicFieldValues) {
        const accountVals = dynamicFieldValues[account.id];
        if (accountVals) {
            const val = accountVals[config.apiName];
            if (val === true) return 'Yes';
            if (val === false) return 'No';
            return val != null ? String(val) : 'None';
        }
        return 'None';
    }
    return account[config.field] || 'None';
}

// Derive short rule-group label from reason string (mirrors App.js getRuleGroup)
function getRuleGroup(account) {
    const r = account.reason || '';
    const action = account.action;
    if (action === 'Add' || action === 'Reclassify') {
        const match = r.match(/→ (Tier \d)/);
        const tier = match ? match[1] : null;
        const isRetarget = r.includes('eligible for re-targeting');
        if (!tier) return 'Other';
        return isRetarget ? `Re-target → ${tier}` : `New → ${tier}`;
    }
    if (action === 'Remove') {
        if (r.includes('Has a parent account')) return 'Has parent account';
        if (r.includes('Account stage') && r.includes('excluded')) {
            const stageMatch = r.match(/Account stage "([^"]+)"/);
            return stageMatch ? `Excluded: ${stageMatch[1]}` : 'Excluded stage';
        }
        if (r.includes('Consulting/IT filter')) return 'Consulting/IT filter';
        if (r.includes('defunct')) return 'Company defunct';
        if (r.includes('Qualified out')) return 'Qualified out';
        return 'Below threshold';
    }
    return 'Other';
}

// Compute effective tier after an approval decision
function effectiveTier(account, approvedIds, rejectedIds) {
    if (approvedIds.has(account.id)) {
        if (account.action === 'Remove') return null;
        return account.recommendedTier || null;
    }
    return account.currentTier || null;
}

export default class AbxTierReview extends LightningElement {
    // ─── State ────────────────────────────────────────────────────────────────
    @track allAccounts = [];
    @track campaignData = null;
    @track approvedIds = new Set();
    @track rejectedIds = new Set();
    @track selectedIds = new Set();
    @track cpApprovedIds = new Set();
    @track cpRejectedIds = new Set();
    @track cpSelectedIds = new Set();

    // Field filter state
    @track fieldFilters = {};       // { intent: Set(['High','Medium']), stage: Set([...]), ... }
    @track filterPanelOpen = false;
    @track activeFilterCategory = null;

    activeTab = 'review';
    activeFilter = 'Current ABX';
    activeReasonFilter = null;
    searchTerm = '';
    isLoading = true;
    isApplying = false;

    // AE assignment state
    @track aeUsers = [];
    @track aeAssignments = {};
    @track aeSearchTerms = {};
    @track activeAEDropdownId = null;
    @track bulkAEPickerOpen = false;
    @track bulkAESearchTerm = '';
    isAssigningAE = false;

    // Dynamic field state
    @track accountFieldDescribe = [];
    @track dynamicFilterFields = [];
    @track dynamicDetailFields = [];
    @track dynamicFieldValues = {};
    @track dynamicFieldSearchTerm = '';
    @track detailFieldSearchTerm = '';
    @track showDynamicFieldPicker = false;
    @track showDetailFieldPicker = false;
    isDynamicFieldsLoading = false;

    _wiredAccountResult;
    _wiredCampaignResult;

    // ─── Wire adapters ────────────────────────────────────────────────────────

    @wire(getAccountReviewData)
    wiredAccounts(result) {
        this._wiredAccountResult = result;
        if (result.data) {
            this.allAccounts = result.data.accounts || [];
            this.isLoading = false;
        } else if (result.error) {
            this.showToast('Error', 'Failed to load account data: ' + this.reduceErrors(result.error), 'error');
            this.isLoading = false;
        }
    }

    // Campaign data wired in parallel (lightweight — ~760 members)
    @wire(getCampaignSyncData)
    wiredCampaign(result) {
        this._wiredCampaignResult = result;
        if (result.data) {
            this.campaignData = result.data;
        } else if (result.error) {
            console.warn('Campaign data load failed:', result.error);
        }
    }

    // AE Users wired for the assignment picker
    @wire(getAEUsers)
    wiredAEUsers(result) {
        if (result.data) {
            this.aeUsers = result.data;
        } else if (result.error) {
            console.warn('Failed to load AE users:', result.error);
        }
    }

    // Account field describe for dynamic field picker
    @wire(getAccountFieldDescribe)
    wiredFieldDescribe(result) {
        if (result.data) {
            this.accountFieldDescribe = [...result.data].sort((a, b) => a.label.localeCompare(b.label));
        }
    }

    // ─── Computed: Review Stats ───────────────────────────────────────────────

    get stats() {
        const accts = this.allAccounts;
        if (!accts.length) return {};

        const currentABX = accts.filter(a => !!effectiveTier(a, this.approvedIds, this.rejectedIds)).length;
        const pendingAdds = accts.filter(a => a.action === 'Add' && !this.approvedIds.has(a.id) && !this.rejectedIds.has(a.id)).length;
        const pendingRemoves = accts.filter(a => a.action === 'Remove' && !this.approvedIds.has(a.id) && !this.rejectedIds.has(a.id)).length;
        const pendingReclassifies = accts.filter(a => a.action === 'Reclassify' && !this.approvedIds.has(a.id) && !this.rejectedIds.has(a.id)).length;
        const estimatedFinalABX = currentABX + pendingAdds - pendingRemoves;
        const unassignedAE = accts.filter(a =>
            !!effectiveTier(a, this.approvedIds, this.rejectedIds) && !a.accountExecutiveName
        ).length;

        // Tier distribution for chart
        const currentTiers = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 };
        const finalTiers = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 };
        accts.forEach(a => {
            if (a.currentTier && currentTiers.hasOwnProperty(a.currentTier)) {
                currentTiers[a.currentTier]++;
            }
            let projectedTier;
            if (this.approvedIds.has(a.id) || this.rejectedIds.has(a.id)) {
                projectedTier = effectiveTier(a, this.approvedIds, this.rejectedIds);
            } else if (a.action === 'Remove') {
                projectedTier = null;
            } else if (a.action === 'Add' || a.action === 'Reclassify') {
                projectedTier = a.recommendedTier;
            } else {
                projectedTier = a.currentTier;
            }
            if (projectedTier && finalTiers.hasOwnProperty(projectedTier)) {
                finalTiers[projectedTier]++;
            }
        });

        return {
            currentABX,
            estimatedFinalABX,
            netChange: estimatedFinalABX - currentABX,
            adds: pendingAdds,
            removes: pendingRemoves,
            reclassifies: pendingReclassifies,
            unassignedAE,
            approvedCount: this.approvedIds.size,
            tierDistribution: { current: currentTiers, final: finalTiers },
        };
    }

    get tierDistribution() {
        return this.stats.tierDistribution || { current: {}, final: {} };
    }

    // ─── Computed: Campaign Stats ─────────────────────────────────────────────

    get campaignStats() {
        if (!this.campaignData?.members || !this.allAccounts.length) {
            return { currentlyInCampaign: 0, toAdd: 0, toRemove: 0, synced: 0 };
        }
        const memberSet = new Set(this.campaignData.members.map(m => m.accountId));
        let toAdd = 0, toRemove = 0, synced = 0;

        this.allAccounts.filter(a => a.action !== 'Ignore').forEach(a => {
            const inCampaign = memberSet.has(a.id);
            const hasTier = !!effectiveTier(a, this.approvedIds, this.rejectedIds);
            let status;
            if (inCampaign && hasTier) status = 'synced';
            else if (!inCampaign && hasTier) status = 'needs-add';
            else if (inCampaign && !hasTier) status = 'needs-remove';
            else return;

            if (this.cpApprovedIds.has(a.id)) {
                if (status === 'needs-add') status = 'synced';
                else if (status === 'needs-remove') return;
            }

            if (status === 'synced') synced++;
            else if (status === 'needs-add') toAdd++;
            else if (status === 'needs-remove') toRemove++;
        });

        return { currentlyInCampaign: synced + toRemove, toAdd, toRemove, synced };
    }

    get pendingSyncCount() {
        const cs = this.campaignStats;
        return cs.toAdd + cs.toRemove;
    }

    // ─── Computed: Filtered Accounts (Review tab) ─────────────────────────────

    get baseFilteredAccounts() {
        let base = this.allAccounts;
        const filter = this.activeFilter;

        // Apply main stat-card filter
        base = base.filter(a => {
            if (filter === 'Current ABX') return !!effectiveTier(a, this.approvedIds, this.rejectedIds);
            if (filter === 'Final ABX') {
                return a.action === 'No Change' || a.action === 'Reclassify' ||
                    (a.action === 'Remove' && this.rejectedIds.has(a.id)) ||
                    (a.action === 'Add' && !this.rejectedIds.has(a.id));
            }
            if (filter === 'Unassigned AE') {
                return !!effectiveTier(a, this.approvedIds, this.rejectedIds) && !a.accountExecutiveName;
            }
            if (['Add', 'Remove', 'Reclassify'].includes(filter)) {
                if (a.action !== filter) return false;
                if (this.approvedIds.has(a.id) || this.rejectedIds.has(a.id)) return false;
                if (this.activeReasonFilter && getRuleGroup(a) !== this.activeReasonFilter) return false;
                return true;
            }
            return true;
        });

        return base;
    }

    get filteredAccounts() {
        let base = this.baseFilteredAccounts;

        // Apply field filters (static + dynamic)
        const activeFilters = this.fieldFilters;
        const dynVals = this.dynamicFieldValues;
        for (const config of this.allFieldConfigs) {
            const selected = activeFilters[config.key];
            if (selected && selected.size > 0) {
                base = base.filter(a => selected.has(getFieldValue(a, config, dynVals)));
            }
        }

        // Apply search
        if (this.searchTerm) {
            const q = this.searchTerm.toLowerCase();
            base = base.filter(a => a.name?.toLowerCase().includes(q));
        }

        return base;
    }

    get filteredCount() {
        return this.filteredAccounts.length;
    }

    get hasAccounts() {
        return this.allAccounts.length > 0;
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

    get allFieldConfigs() {
        return [
            ...FIELD_CONFIGS,
            ...this.dynamicFilterFields.map(f => ({
                key: f.key,
                label: f.label,
                field: null,
                apiName: f.apiName,
                isDynamic: true,
            })),
        ];
    }

    get filterCategories() {
        const accounts = this.baseFilteredAccounts;
        const dynVals = this.dynamicFieldValues;
        return this.allFieldConfigs.map(config => {
            const values = new Set();
            accounts.forEach(a => values.add(getFieldValue(a, config, dynVals)));
            if (values.size <= 1) return null; // skip single-value categories

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
                isDynamic: !!config.isDynamic,
                isActive: this.activeFilterCategory === config.key,
                catClass: this.activeFilterCategory === config.key
                    ? 'filter-cat filter-cat--active' : 'filter-cat',
                hasSelections: selected.size > 0,
                values: sortedValues.map(v => ({
                    value: v,
                    label: v,
                    checked: selected.has(v),
                    count: accounts.filter(a => getFieldValue(a, config, dynVals) === v).length,
                })),
            };
        }).filter(Boolean);
    }

    handleToggleFilterPanel() {
        this.filterPanelOpen = !this.filterPanelOpen;
        if (this.filterPanelOpen && !this.activeFilterCategory && this.filterCategories.length > 0) {
            this.activeFilterCategory = this.filterCategories[0].key;
        }
        if (!this.filterPanelOpen) {
            this.showDynamicFieldPicker = false;
            this.dynamicFieldSearchTerm = '';
        }
    }

    handleFilterCategoryClick(event) {
        this.activeFilterCategory = event.currentTarget.dataset.key;
        this.showDynamicFieldPicker = false;
        this.dynamicFieldSearchTerm = '';
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

    // ─── Computed: Reason Groups ──────────────────────────────────────────────

    get reasonGroups() {
        const ACTIONABLE = ['Add', 'Remove', 'Reclassify'];
        if (!ACTIONABLE.includes(this.activeFilter)) return [];
        const counts = {};
        this.allAccounts
            .filter(a => a.action === this.activeFilter && !this.approvedIds.has(a.id) && !this.rejectedIds.has(a.id))
            .forEach(a => {
                const g = getRuleGroup(a);
                counts[g] = (counts[g] || 0) + 1;
            });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => ({
                label,
                count,
                isActive: this.activeReasonFilter === label,
                cssClass: this.activeReasonFilter === label
                    ? 'slds-badge slds-theme_success slds-m-right_xx-small'
                    : 'slds-badge slds-m-right_xx-small',
            }));
    }

    get hasReasonGroups() {
        return this.reasonGroups.length > 0;
    }

    // ─── Computed: Datatable rows ─────────────────────────────────────────────

    get datatableRows() {
        const dynVals = this.dynamicFieldValues;
        const isUnassignedAE = this.activeFilter === 'Unassigned AE';
        return this.filteredAccounts.map(a => {
            const isActionable = ['Add', 'Remove', 'Reclassify'].includes(a.action)
                && !this.approvedIds.has(a.id);
            return {
                ...a,
                accountUrl: `/lightning/r/Account/${a.id}/view`,
                actionClass: ACTION_CLASSES[a.action] || 'slds-badge',
                fitScoreDisplay: a.fitScore != null ? String(a.fitScore) : '—',
                intentDisplay: a.intent || '—',
                stageDisplay: a.stage || '—',
                dnnDisplay: a.isDnn ? 'Yes' : 'No',
                aeTerritoryDisplay: a.aeTerritory || null,
                accountExecutiveName: a.accountExecutiveName || null,
                accountExecutiveId: a.accountExecutiveId || null,
                hasAE: !!a.accountExecutiveName,
                accountDevOwnerName: a.accountDevOwnerName || null,
                hasDevOwner: !!a.accountDevOwnerName,
                aeSearchTerm: this.aeSearchTerms[a.id] || '',
                showAEDropdown: this.activeAEDropdownId === a.id,
                filteredAEUsers: this._getFilteredAEUsers(a.id),
                hasPendingAE: this.aeAssignments.hasOwnProperty(a.id),
                isApproved: this.approvedIds.has(a.id),
                isRejected: this.rejectedIds.has(a.id),
                isSelected: this.selectedIds.has(a.id),
                isActionable,
                isSelectable: isActionable || isUnassignedAE,
                statusLabel: this.approvedIds.has(a.id) ? 'Approved' :
                    this.rejectedIds.has(a.id) ? 'Rejected' : 'Pending',
                statusClass: this.approvedIds.has(a.id) ? 'slds-text-color_success' :
                    this.rejectedIds.has(a.id) ? 'slds-text-color_error' : '',
                ruleGroup: getRuleGroup(a),
                showRuleGroup: a.action !== 'No Change',
                dynamicDetails: this.dynamicDetailFields.map(f => {
                    const accountVals = dynVals[a.id];
                    let rawValue = accountVals ? accountVals[f.apiName] : null;
                    if (rawValue === true) rawValue = 'Yes';
                    else if (rawValue === false) rawValue = 'No';
                    return {
                        key: f.key,
                        label: f.label,
                        value: rawValue != null ? String(rawValue) : '—',
                    };
                }),
                hasDynamicDetails: this.dynamicDetailFields.length > 0,
            };
        });
    }

    // ─── Tab handling ─────────────────────────────────────────────────────────

    get isReviewTab() {
        return this.activeTab === 'review';
    }

    get isCampaignTab() {
        return this.activeTab === 'campaign';
    }

    get campaignTabLabel() {
        return this.pendingSyncCount > 0
            ? `Campaign Sync (${this.pendingSyncCount})`
            : 'Campaign Sync';
    }

    handleTabChange(event) {
        this.activeTab = event.target.value;
    }

    // ─── Filter stats bar handling ────────────────────────────────────────────

    handleStatClick(event) {
        const filter = event.detail ? event.detail.filter : event.currentTarget.dataset.filter;
        this.activeFilter = filter;
        this.activeReasonFilter = null;
        this.selectedIds = new Set();
    }

    handleReasonClick(event) {
        const reason = event.currentTarget.dataset.reason;
        this.activeReasonFilter = this.activeReasonFilter === reason ? null : reason;
    }

    // ─── Search ───────────────────────────────────────────────────────────────

    handleSearchChange(event) {
        this.searchTerm = event.target.value;
    }

    handleClearSearch() {
        this.searchTerm = '';
    }

    // ─── Approve / Reject handlers ────────────────────────────────────────────

    handleApprove(event) {
        const id = event.currentTarget.dataset.id;
        const newApproved = new Set(this.approvedIds);
        newApproved.add(id);
        this.approvedIds = newApproved;

        const newRejected = new Set(this.rejectedIds);
        newRejected.delete(id);
        this.rejectedIds = newRejected;
    }

    handleReject(event) {
        const id = event.currentTarget.dataset.id;
        const newRejected = new Set(this.rejectedIds);
        newRejected.add(id);
        this.rejectedIds = newRejected;

        const newApproved = new Set(this.approvedIds);
        newApproved.delete(id);
        this.approvedIds = newApproved;
    }

    handleUndoDecision(event) {
        const id = event.currentTarget.dataset.id;
        const newApproved = new Set(this.approvedIds);
        newApproved.delete(id);
        this.approvedIds = newApproved;

        const newRejected = new Set(this.rejectedIds);
        newRejected.delete(id);
        this.rejectedIds = newRejected;
    }

    // ─── Bulk actions ─────────────────────────────────────────────────────────

    get isActionableFilter() {
        return ['Add', 'Remove', 'Reclassify'].includes(this.activeFilter);
    }

    get isUnassignedAEFilter() {
        return this.activeFilter === 'Unassigned AE';
    }

    get showSelectAll() {
        return this.isActionableFilter || this.isUnassignedAEFilter;
    }

    get actionableRows() {
        return this.filteredAccounts.filter(a =>
            ['Add', 'Remove', 'Reclassify'].includes(a.action) && !this.approvedIds.has(a.id)
        );
    }

    get selectableRows() {
        if (this.isUnassignedAEFilter) return this.filteredAccounts;
        return this.actionableRows;
    }

    get selectedCount() {
        return [...this.selectedIds].filter(id =>
            this.selectableRows.some(a => a.id === id)
        ).length;
    }

    get hasSelection() {
        return this.selectedCount > 0;
    }

    get allSelected() {
        const rows = this.selectableRows;
        return rows.length > 0 && rows.every(a => this.selectedIds.has(a.id));
    }

    handleToggleSelect(event) {
        const id = event.currentTarget.dataset.id;
        const newSelected = new Set(this.selectedIds);
        if (newSelected.has(id)) newSelected.delete(id);
        else newSelected.add(id);
        this.selectedIds = newSelected;
    }

    handleSelectAll() {
        if (this.allSelected) {
            this.selectedIds = new Set();
        } else {
            this.selectedIds = new Set(this.selectableRows.map(a => a.id));
        }
    }

    handleApproveSelected() {
        const newApproved = new Set(this.approvedIds);
        const newRejected = new Set(this.rejectedIds);
        this.selectedIds.forEach(id => {
            newApproved.add(id);
            newRejected.delete(id);
        });
        this.approvedIds = newApproved;
        this.rejectedIds = newRejected;
        this.selectedIds = new Set();
    }

    handleRejectSelected() {
        const newRejected = new Set(this.rejectedIds);
        const newApproved = new Set(this.approvedIds);
        this.selectedIds.forEach(id => {
            newRejected.add(id);
            newApproved.delete(id);
        });
        this.approvedIds = newApproved;
        this.rejectedIds = newRejected;
        this.selectedIds = new Set();
    }

    // ─── Apply to Salesforce ──────────────────────────────────────────────────

    get hasApprovedChanges() {
        return this.approvedIds.size > 0;
    }

    get applyButtonLabel() {
        return this.isApplying ? 'Applying...' : `Apply ${this.approvedIds.size} Changes`;
    }

    async handleApplyChanges() {
        if (!this.approvedIds.size) return;
        this.isApplying = true;

        try {
            const changes = this.allAccounts
                .filter(a => this.approvedIds.has(a.id) && a.action !== 'No Change' && a.action !== 'Ignore')
                .map(a => ({
                    accountId: a.id,
                    action: a.action,
                    tier: a.recommendedTier,
                }));

            if (changes.length === 0) {
                this.showToast('Info', 'No actionable changes to apply.', 'info');
                this.isApplying = false;
                return;
            }

            const result = await applyTierChanges({ changesJson: JSON.stringify(changes) });

            if (result.ok) {
                this.showToast('Success',
                    `Tier changes applied: ${result.added} added, ${result.removed} removed, ${result.updated} updated.`,
                    'success');
                this.approvedIds = new Set();
                this.rejectedIds = new Set();
                this.selectedIds = new Set();
                await refreshApex(this._wiredAccountResult);
            } else {
                this.showToast('Warning',
                    `Changes applied with errors: ${result.errors.join('; ')}`,
                    'warning');
            }
        } catch (error) {
            this.showToast('Error', 'Failed to apply changes: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isApplying = false;
        }
    }

    // ─── Reset ────────────────────────────────────────────────────────────────

    handleReset() {
        this.approvedIds = new Set();
        this.rejectedIds = new Set();
        this.selectedIds = new Set();
        this.searchTerm = '';
        this.activeReasonFilter = null;
        this.fieldFilters = {};
        this.filterPanelOpen = false;
        this.aeAssignments = {};
        this.aeSearchTerms = {};
        this.activeAEDropdownId = null;
        this.bulkAEPickerOpen = false;
        this.bulkAESearchTerm = '';
        this.dynamicFilterFields = [];
        this.dynamicDetailFields = [];
        this.dynamicFieldValues = {};
        this.showDynamicFieldPicker = false;
        this.showDetailFieldPicker = false;
    }

    // ─── Refresh ──────────────────────────────────────────────────────────────

    async handleRefresh() {
        this.isLoading = true;
        this.approvedIds = new Set();
        this.rejectedIds = new Set();
        this.selectedIds = new Set();
        this.fieldFilters = {};
        this.aeAssignments = {};
        this.aeSearchTerms = {};
        this.activeAEDropdownId = null;
        this.bulkAEPickerOpen = false;
        await Promise.all([
            refreshApex(this._wiredAccountResult),
            refreshApex(this._wiredCampaignResult),
        ]);
    }

    // ─── Campaign Sync handlers (dispatched from c-abx-campaign-sync) ─────────

    handleCpApprove(event) {
        const id = event.detail.accountId;
        const newApproved = new Set(this.cpApprovedIds);
        newApproved.add(id);
        this.cpApprovedIds = newApproved;

        const newRejected = new Set(this.cpRejectedIds);
        newRejected.delete(id);
        this.cpRejectedIds = newRejected;
    }

    handleCpReject(event) {
        const id = event.detail.accountId;
        const newRejected = new Set(this.cpRejectedIds);
        newRejected.add(id);
        this.cpRejectedIds = newRejected;

        const newApproved = new Set(this.cpApprovedIds);
        newApproved.delete(id);
        this.cpApprovedIds = newApproved;
    }

    async handleCpSync(event) {
        const changes = event.detail.changes;
        this.isApplying = true;

        try {
            const result = await syncCampaignMembership({ changesJson: JSON.stringify(changes) });
            if (result.ok) {
                this.showToast('Success',
                    `Campaign sync complete: ${result.added} added, ${result.removed} removed.`,
                    'success');
                this.cpApprovedIds = new Set();
                this.cpRejectedIds = new Set();
                await refreshApex(this._wiredCampaignResult);
            } else {
                this.showToast('Warning',
                    `Campaign sync with errors: ${result.errors.join('; ')}`,
                    'warning');
            }
        } catch (error) {
            this.showToast('Error', 'Campaign sync failed: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isApplying = false;
        }
    }

    // ─── Row expansion ────────────────────────────────────────────────────────

    handleToggleExpand(event) {
        const id = event.currentTarget.dataset.id;
        const el = this.template.querySelector(`[data-detail-id="${id}"]`);
        if (el) {
            el.classList.toggle('slds-hide');
        }
    }

    // ─── AE Assignment ────────────────────────────────────────────────────────

    _getFilteredAEUsers(accountId) {
        const term = (this.aeSearchTerms[accountId] || '').toLowerCase();
        if (!term) return this.aeUsers.slice(0, 20);
        return this.aeUsers.filter(u => u.name.toLowerCase().includes(term)).slice(0, 20);
    }

    get filteredBulkAEUsers() {
        const term = (this.bulkAESearchTerm || '').toLowerCase();
        if (!term) return this.aeUsers.slice(0, 20);
        return this.aeUsers.filter(u => u.name.toLowerCase().includes(term)).slice(0, 20);
    }

    handleAESearchFocus(event) {
        this.activeAEDropdownId = event.currentTarget.dataset.id;
    }

    handleAESearchInput(event) {
        const id = event.currentTarget.dataset.id;
        const term = event.target.value;
        this.aeSearchTerms = { ...this.aeSearchTerms, [id]: term };
        this.activeAEDropdownId = id;
    }

    handleAESelect(event) {
        const accountId = event.currentTarget.dataset.id;
        const userId = event.currentTarget.dataset.userId;
        const userName = this.aeUsers.find(u => u.userId === userId)?.name || '';
        this.aeAssignments = { ...this.aeAssignments, [accountId]: userId };
        this.aeSearchTerms = { ...this.aeSearchTerms, [accountId]: userName };
        this.activeAEDropdownId = null;
    }

    async handleSaveAE(event) {
        const accountId = event.currentTarget.dataset.id;
        const userId = this.aeAssignments[accountId];
        if (userId === undefined) return;

        this.isAssigningAE = true;
        try {
            const assignments = [{ accountId, userId: userId || null }];
            const result = await assignAccountExecutives({
                assignmentsJson: JSON.stringify(assignments)
            });
            if (result.ok) {
                this.showToast('Success', 'Account Executive assigned.', 'success');
                const newAssignments = { ...this.aeAssignments };
                delete newAssignments[accountId];
                this.aeAssignments = newAssignments;
                const newTerms = { ...this.aeSearchTerms };
                delete newTerms[accountId];
                this.aeSearchTerms = newTerms;
                await refreshApex(this._wiredAccountResult);
            } else {
                this.showToast('Error', result.errors.join('; '), 'error');
            }
        } catch (error) {
            this.showToast('Error', 'AE assignment failed: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isAssigningAE = false;
        }
    }

    handleBulkAEClick() {
        this.bulkAEPickerOpen = !this.bulkAEPickerOpen;
        this.bulkAESearchTerm = '';
    }

    handleBulkAESearch(event) {
        this.bulkAESearchTerm = event.target.value;
    }

    async handleBulkAESelect(event) {
        const userId = event.currentTarget.dataset.userId;
        const selectedAccountIds = [...this.selectedIds];
        if (!selectedAccountIds.length) return;

        this.bulkAEPickerOpen = false;
        this.isAssigningAE = true;
        try {
            const assignments = selectedAccountIds.map(accountId => ({ accountId, userId }));
            const result = await assignAccountExecutives({
                assignmentsJson: JSON.stringify(assignments)
            });
            if (result.ok) {
                this.showToast('Success',
                    `Account Executive assigned to ${result.updated} accounts.`, 'success');
                this.selectedIds = new Set();
                await refreshApex(this._wiredAccountResult);
            } else {
                this.showToast('Warning',
                    `Partial success with errors: ${result.errors.join('; ')}`, 'warning');
            }
        } catch (error) {
            this.showToast('Error', 'Bulk AE assignment failed: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isAssigningAE = false;
        }
    }

    // ─── Dynamic Field Pickers ────────────────────────────────────────────────

    get filteredFieldDescribe() {
        const existingFields = new Set([
            ...FIELD_CONFIGS.map(c => c.field).filter(Boolean),
            ...this.dynamicFilterFields.map(f => f.apiName),
        ]);
        let fields = this.accountFieldDescribe.filter(f => !existingFields.has(f.apiName));
        if (this.dynamicFieldSearchTerm) {
            const q = this.dynamicFieldSearchTerm.toLowerCase();
            fields = fields.filter(f =>
                f.label.toLowerCase().includes(q) || f.apiName.toLowerCase().includes(q)
            );
        }
        return fields.slice(0, 30);
    }

    get filteredDetailFieldDescribe() {
        const existing = new Set(this.dynamicDetailFields.map(f => f.apiName));
        let fields = this.accountFieldDescribe.filter(f => !existing.has(f.apiName));
        if (this.detailFieldSearchTerm) {
            const q = this.detailFieldSearchTerm.toLowerCase();
            fields = fields.filter(f =>
                f.label.toLowerCase().includes(q) || f.apiName.toLowerCase().includes(q)
            );
        }
        return fields.slice(0, 30);
    }

    handleToggleDynamicFieldPicker() {
        this.showDynamicFieldPicker = !this.showDynamicFieldPicker;
        this.dynamicFieldSearchTerm = '';
    }

    handleDynamicFieldSearch(event) {
        this.dynamicFieldSearchTerm = event.target.value;
    }

    async handleAddDynamicFilter(event) {
        const apiName = event.currentTarget.dataset.apiName;
        const field = this.accountFieldDescribe.find(f => f.apiName === apiName);
        if (!field) return;

        this.dynamicFilterFields = [
            ...this.dynamicFilterFields,
            { apiName: field.apiName, label: field.label, type: field.type, key: `dyn_${field.apiName}` }
        ];
        this.showDynamicFieldPicker = false;
        this.dynamicFieldSearchTerm = '';
        this.activeFilterCategory = `dyn_${field.apiName}`;

        await this._fetchDynamicFieldValues();
    }

    handleRemoveDynamicFilter(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        this.dynamicFilterFields = this.dynamicFilterFields.filter(f => f.key !== key);
        const newFilters = { ...this.fieldFilters };
        delete newFilters[key];
        this.fieldFilters = newFilters;
        if (this.activeFilterCategory === key && this.filterCategories.length > 0) {
            this.activeFilterCategory = this.filterCategories[0].key;
        }
    }

    handleToggleDetailFieldPicker() {
        this.showDetailFieldPicker = !this.showDetailFieldPicker;
        this.detailFieldSearchTerm = '';
    }

    handleDetailFieldSearch(event) {
        this.detailFieldSearchTerm = event.target.value;
    }

    async handleAddDetailField(event) {
        const apiName = event.currentTarget.dataset.apiName;
        const field = this.accountFieldDescribe.find(f => f.apiName === apiName);
        if (!field) return;

        this.dynamicDetailFields = [
            ...this.dynamicDetailFields,
            { apiName: field.apiName, label: field.label, type: field.type, key: `det_${field.apiName}` }
        ];
        this.showDetailFieldPicker = false;
        this.detailFieldSearchTerm = '';

        await this._fetchDynamicFieldValues();
    }

    handleRemoveDetailField(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        this.dynamicDetailFields = this.dynamicDetailFields.filter(f => f.key !== key);
    }

    async _fetchDynamicFieldValues() {
        const filterFieldNames = this.dynamicFilterFields.map(f => f.apiName);
        const detailFieldNames = this.dynamicDetailFields.map(f => f.apiName);
        const allFieldNames = [...new Set([...filterFieldNames, ...detailFieldNames])];
        const accountIds = this.allAccounts.map(a => a.id);

        if (!accountIds.length || !allFieldNames.length) return;

        this.isDynamicFieldsLoading = true;
        try {
            const result = await getDynamicFieldValues({
                fieldNames: allFieldNames,
                accountIds,
            });
            this.dynamicFieldValues = result;
        } catch (error) {
            this.showToast('Error', 'Failed to load field data: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isDynamicFieldsLoading = false;
        }
    }

    // Close filter panel, AE dropdown, and bulk picker when clicking outside
    handleBodyClick(event) {
        const path = event.composedPath();

        if (this.filterPanelOpen) {
            const panel = this.template.querySelector('.filter-panel');
            const btn = this.template.querySelector('.filter-toggle-btn');
            const clickedPanel = panel && path.includes(panel);
            const clickedBtn = btn && path.includes(btn);
            if (!clickedPanel && !clickedBtn) {
                this.filterPanelOpen = false;
            }
        }

        if (this.activeAEDropdownId) {
            const aeWrappers = this.template.querySelectorAll('.ae-combobox-wrapper');
            const clickedAE = Array.from(aeWrappers).some(w => path.includes(w));
            if (!clickedAE) {
                this.activeAEDropdownId = null;
            }
        }

        if (this.bulkAEPickerOpen) {
            const bulkPanel = this.template.querySelector('.ae-bulk-panel');
            const bulkBtn = this.template.querySelector('.bulk-ae-btn');
            const clickedBulk = (bulkPanel && path.includes(bulkPanel)) || (bulkBtn && path.includes(bulkBtn));
            if (!clickedBulk) {
                this.bulkAEPickerOpen = false;
            }
        }

        if (this.showDynamicFieldPicker) {
            const dynPicker = this.template.querySelector('.dynamic-field-picker');
            const addBtn = this.template.querySelector('.filter-cat--add');
            const clickedDyn = (dynPicker && path.includes(dynPicker)) || (addBtn && path.includes(addBtn));
            if (!clickedDyn) {
                this.showDynamicFieldPicker = false;
            }
        }

        if (this.showDetailFieldPicker) {
            const detPicker = this.template.querySelector('.detail-field-picker');
            const detBtn = this.template.querySelector('.detail-add-field-btn');
            const clickedDet = (detPicker && path.includes(detPicker)) || (detBtn && path.includes(detBtn));
            if (!clickedDet) {
                this.showDetailFieldPicker = false;
            }
        }
    }

    connectedCallback() {
        this._bodyClickHandler = this.handleBodyClick.bind(this);
        // eslint-disable-next-line @lwc/lwc/no-document-query
        document.addEventListener('click', this._bodyClickHandler);
    }

    disconnectedCallback() {
        document.removeEventListener('click', this._bodyClickHandler);
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    reduceErrors(error) {
        if (typeof error === 'string') return error;
        if (error?.body?.message) return error.body.message;
        if (error?.message) return error.message;
        if (Array.isArray(error?.body)) return error.body.map(e => e.message).join(', ');
        return JSON.stringify(error);
    }
}
