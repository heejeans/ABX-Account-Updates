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
import bulkUpdateAccountFields from '@salesforce/apex/ABXTierReviewController.bulkUpdateAccountFields';

// Action badge CSS classes
const ACTION_CLASSES = {
    'Add': 'slds-badge slds-theme_success',
    'Remove': 'slds-badge slds-theme_error',
    'Reclassify': 'slds-badge slds-theme_warning',
    'No Change': 'slds-badge slds-theme_default',
    'Ignore': 'slds-badge',
};

// Field filter category definitions (mirrors React FieldFilters FIELD_CONFIGS)
// filterType: 'picklist' (checkboxes), 'number' (operator + value), 'text' (operator + value)
const FIELD_CONFIGS = [
    { key: 'intent', label: 'Account Intent', field: 'intent', filterType: 'picklist', order: ['High', 'Medium', 'Low', 'None'] },
    { key: 'stage', label: 'Account Stage', field: 'stage', filterType: 'picklist' },
    { key: 'segment', label: 'Sales Segment', field: 'segment', filterType: 'picklist' },
    { key: 'fitScore', label: 'Fit Score Total', field: 'fitScore', filterType: 'number' },
    { key: 'currentTier', label: 'ABX Tier', field: 'currentTier', filterType: 'picklist', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'expectedTier', label: 'Expected ABX Tier', field: null, filterType: 'picklist', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
    { key: 'recommendedTier', label: 'Projected Tier', field: 'recommendedTier', filterType: 'picklist', order: ['Tier 1', 'Tier 2', 'Tier 3', 'No Tier'] },
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

/**
 * Apply a single operator-based filter to a value.
 * For number: value is numeric; for text: value is string.
 */
function matchesOperatorFilter(val, filter, filterType) {
    const op = filter.operator;
    if (op === 'empty') return val == null || val === '' || val === 'None';
    if (op === 'notEmpty') return val != null && val !== '' && val !== 'None';

    if (filterType === 'number') {
        const numVal = (val != null) ? Number(val) : null;
        // Parse comma-separated values for equals/not-equals
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
        // Text
        const strVal = val != null ? String(val).toLowerCase() : '';
        const fv = filter.value ? filter.value.toLowerCase() : '';
        if (op === 'eq') return strVal === fv;
        if (op === 'neq') return strVal !== fv;
        if (op === 'contains') return strVal.includes(fv);
        if (op === 'notContains') return !strVal.includes(fv);
    }
    return true;
}

const ACTIONABLE_ACTIONS = new Set(['Add', 'Remove', 'Reclassify']);

function getFieldValue(account, config, dynamicFieldValues) {
    if (config.key === 'dnn') return account.isDnn ? 'DNN' : 'Non-DNN';
    if (config.key === 'aeStatus') return account.accountExecutiveName ? 'Assigned' : 'Unassigned';
    if (config.key === 'currentTier') return account.currentTier || 'No Tier';
    if (config.key === 'expectedTier') {
        // What the tier will be after recommendations are applied
        if (account.action === 'Add' || account.action === 'Reclassify') {
            return account.recommendedTier || 'No Tier';
        }
        if (account.action === 'Remove') {
            return 'No Tier';
        }
        // No Change / Ignore — stays at current tier
        return account.currentTier || 'No Tier';
    }
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
    @track fieldFilters = {};       // { intent: Set(['High','Medium']), fitScore: { min, max }, ... }
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

    // Bulk field update state
    @track bulkUpdatePickerOpen = false;
    @track bulkUpdateFieldSearch = '';
    @track bulkUpdateSelectedField = null;
    @track bulkUpdateFieldValue = '';
    @track bulkUpdateQueue = []; // Array of { apiName, label, value, displayValue }
    isBulkUpdating = false;

    _wiredAccountResult;
    _wiredCampaignResult;

    // ─── Memoization caches ────────────────────────────────────────────────
    // Each expensive getter checks if its dependencies changed by reference.
    // If unchanged, returns the cached result — prevents recomputation on
    // unrelated state changes (e.g. checkbox toggle doesn't recompute stats).

    _cachedStats = null;
    _statsDep1 = null; // allAccounts
    _statsDep2 = null; // approvedIds
    _statsDep3 = null; // rejectedIds

    _cachedBaseFiltered = null;
    _bfDep1 = null; // allAccounts
    _bfDep2 = null; // activeFilter
    _bfDep3 = null; // approvedIds
    _bfDep4 = null; // rejectedIds
    _bfDep5 = null; // activeReasonFilter

    _cachedFiltered = null;
    _fDep1 = null; // baseFilteredAccounts ref
    _fDep2 = null; // fieldFilters
    _fDep3 = null; // searchTerm
    _fDep4 = null; // dynamicFieldValues
    _fDep5 = null; // dynamicFilterFields

    _cachedFilterCats = null;
    _fcDep1 = null; // baseFilteredAccounts ref
    _fcDep2 = null; // fieldFilters
    _fcDep3 = null; // activeFilterCategory
    _fcDep4 = null; // dynamicFieldValues
    _fcDep5 = null; // dynamicFilterFields

    _cachedReasonGroups = null;
    _rgDep1 = null; // allAccounts
    _rgDep2 = null; // activeFilter
    _rgDep3 = null; // approvedIds
    _rgDep4 = null; // rejectedIds
    _rgDep5 = null; // activeReasonFilter

    _cachedBaseRows = null;
    _brDep1 = null; // filteredAccounts ref
    _brDep2 = null; // dynamicFieldValues
    _brDep3 = null; // dynamicDetailFields
    _brDep4 = null; // approvedIds

    // Pre-computed ruleGroup cache (keyed by account id — stable after data load)
    _ruleGroupCache = new Map();

    // Selectable IDs set for fast selectedCount
    _cachedSelectableIdSet = null;
    _selDep1 = null; // selectableRows ref

    // Debounce timer for search
    _searchTimer = null;

    // ─── Wire adapters ────────────────────────────────────────────────────────

    @wire(getAccountReviewData)
    wiredAccounts(result) {
        this._wiredAccountResult = result;
        if (result.data) {
            this.allAccounts = result.data.accounts || [];
            this._ruleGroupCache = new Map();
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

    // ─── Computed: Review Stats (memoized, single-pass) ───────────────────

    get stats() {
        // Return cache if dependencies unchanged
        if (this._statsDep1 === this.allAccounts
            && this._statsDep2 === this.approvedIds
            && this._statsDep3 === this.rejectedIds
            && this._cachedStats) {
            return this._cachedStats;
        }

        const accts = this.allAccounts;
        if (!accts.length) {
            this._cachedStats = {};
            this._statsDep1 = this.allAccounts;
            this._statsDep2 = this.approvedIds;
            this._statsDep3 = this.rejectedIds;
            return this._cachedStats;
        }

        // Single pass over all accounts
        let currentABX = 0, pendingAdds = 0, pendingRemoves = 0,
            pendingReclassifies = 0, unassignedAE = 0;
        const currentTiers = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 };
        const finalTiers = { 'Tier 1': 0, 'Tier 2': 0, 'Tier 3': 0 };
        const approved = this.approvedIds;
        const rejected = this.rejectedIds;

        for (let i = 0, len = accts.length; i < len; i++) {
            const a = accts[i];
            const tier = effectiveTier(a, approved, rejected);
            const hasTier = !!tier;
            const isPending = !approved.has(a.id) && !rejected.has(a.id);

            if (hasTier) {
                currentABX++;
                if (!a.accountExecutiveName) unassignedAE++;
            }

            if (isPending) {
                if (a.action === 'Add') pendingAdds++;
                else if (a.action === 'Remove') pendingRemoves++;
                else if (a.action === 'Reclassify') pendingReclassifies++;
            }

            // Current tier distribution
            if (a.currentTier && currentTiers.hasOwnProperty(a.currentTier)) {
                currentTiers[a.currentTier]++;
            }

            // Final/projected tier distribution
            let projectedTier;
            if (!isPending) {
                projectedTier = tier;
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
        }

        const estimatedFinalABX = currentABX + pendingAdds - pendingRemoves;
        const result = {
            currentABX,
            estimatedFinalABX,
            netChange: estimatedFinalABX - currentABX,
            adds: pendingAdds,
            removes: pendingRemoves,
            reclassifies: pendingReclassifies,
            unassignedAE,
            approvedCount: approved.size,
            tierDistribution: { current: currentTiers, final: finalTiers },
        };

        this._cachedStats = result;
        this._statsDep1 = this.allAccounts;
        this._statsDep2 = this.approvedIds;
        this._statsDep3 = this.rejectedIds;
        return result;
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

    // ─── Computed: Filtered Accounts (memoized) ───────────────────────────

    get baseFilteredAccounts() {
        if (this._bfDep1 === this.allAccounts
            && this._bfDep2 === this.activeFilter
            && this._bfDep3 === this.approvedIds
            && this._bfDep4 === this.rejectedIds
            && this._bfDep5 === this.activeReasonFilter
            && this._cachedBaseFiltered) {
            return this._cachedBaseFiltered;
        }

        const filter = this.activeFilter;
        const approved = this.approvedIds;
        const rejected = this.rejectedIds;
        const reasonFilter = this.activeReasonFilter;
        const result = [];

        for (let i = 0, len = this.allAccounts.length; i < len; i++) {
            const a = this.allAccounts[i];
            let include = false;

            if (filter === 'Current ABX') {
                include = !!effectiveTier(a, approved, rejected);
            } else if (filter === 'Final ABX') {
                include = a.action === 'No Change' || a.action === 'Reclassify' ||
                    (a.action === 'Remove' && rejected.has(a.id)) ||
                    (a.action === 'Add' && !rejected.has(a.id));
            } else if (filter === 'Unassigned AE') {
                include = !!a.currentTier && !a.accountExecutiveName;
            } else if (ACTIONABLE_ACTIONS.has(filter)) {
                include = a.action === filter
                    && !approved.has(a.id) && !rejected.has(a.id)
                    && (!reasonFilter || this._getRuleGroup(a) === reasonFilter);
            } else {
                include = true;
            }

            if (include) result.push(a);
        }

        this._cachedBaseFiltered = result;
        this._bfDep1 = this.allAccounts;
        this._bfDep2 = this.activeFilter;
        this._bfDep3 = this.approvedIds;
        this._bfDep4 = this.rejectedIds;
        this._bfDep5 = this.activeReasonFilter;
        return result;
    }

    get filteredAccounts() {
        if (this._fDep1 === this.baseFilteredAccounts
            && this._fDep2 === this.fieldFilters
            && this._fDep3 === this.searchTerm
            && this._fDep4 === this.dynamicFieldValues
            && this._fDep5 === this.dynamicFilterFields
            && this._cachedFiltered) {
            return this._cachedFiltered;
        }

        let base = this.baseFilteredAccounts;
        const activeFilters = this.fieldFilters;
        const dynVals = this.dynamicFieldValues;
        const configs = this.allFieldConfigs;

        // Apply field filters (static + dynamic)
        for (let c = 0, cLen = configs.length; c < cLen; c++) {
            const config = configs[c];
            const selected = activeFilters[config.key];
            if (!selected) continue;
            const ft = config.filterType || 'picklist';

            if (selected.operator) {
                // Operator-based filter (number / text)
                const filtered = [];
                for (let i = 0, len = base.length; i < len; i++) {
                    const val = ft === 'number'
                        ? base[i][config.field]
                        : getFieldValue(base[i], config, dynVals);
                    if (matchesOperatorFilter(val, selected, ft)) {
                        filtered.push(base[i]);
                    }
                }
                base = filtered;
            } else if (selected.size > 0) {
                // Picklist checkbox filter
                const filtered = [];
                for (let i = 0, len = base.length; i < len; i++) {
                    if (selected.has(getFieldValue(base[i], config, dynVals))) {
                        filtered.push(base[i]);
                    }
                }
                base = filtered;
            }
        }

        // Apply search
        if (this.searchTerm) {
            const q = this.searchTerm.toLowerCase();
            const searched = [];
            for (let i = 0, len = base.length; i < len; i++) {
                if (base[i].name && base[i].name.toLowerCase().indexOf(q) !== -1) {
                    searched.push(base[i]);
                }
            }
            base = searched;
        }

        this._cachedFiltered = base;
        this._fDep1 = this.baseFilteredAccounts;
        this._fDep2 = this.fieldFilters;
        this._fDep3 = this.searchTerm;
        this._fDep4 = this.dynamicFieldValues;
        this._fDep5 = this.dynamicFilterFields;
        return base;
    }

    get filteredCount() {
        return this.filteredAccounts.length;
    }

    get hasAccounts() {
        return this.allAccounts.length > 0;
    }

    // ─── Field Filter Logic ───────────────────────────────────────────────

    get activeFieldFilterCount() {
        let count = 0;
        const filters = this.fieldFilters;
        for (const key in filters) {
            const f = filters[key];
            if (!f) continue;
            // Operator-based filter (number/text)
            if (f.operator) { count++; continue; }
            // Checkbox filter (Set)
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

    get allFieldConfigs() {
        return [
            ...FIELD_CONFIGS,
            ...this.dynamicFilterFields.map(f => ({
                key: f.key,
                label: f.label,
                field: null,
                apiName: f.apiName,
                isDynamic: true,
                filterType: f.filterType || 'picklist',
            })),
        ];
    }

    // Memoized + single-pass count computation (was O(n×v) per config, now O(n))
    get filterCategories() {
        if (this._fcDep1 === this.baseFilteredAccounts
            && this._fcDep2 === this.fieldFilters
            && this._fcDep3 === this.activeFilterCategory
            && this._fcDep4 === this.dynamicFieldValues
            && this._fcDep5 === this.dynamicFilterFields
            && this._cachedFilterCats) {
            return this._cachedFilterCats;
        }

        const accounts = this.baseFilteredAccounts;
        const dynVals = this.dynamicFieldValues;
        const configs = this.allFieldConfigs;
        const result = [];

        for (let c = 0, cLen = configs.length; c < cLen; c++) {
            const config = configs[c];
            const isActive = this.activeFilterCategory === config.key;
            const ft = config.filterType || 'picklist';

            // Operator-based filters (number / text)
            if (ft === 'number' || ft === 'text') {
                const filter = this.fieldFilters[config.key]; // { operator, value, value2 } or undefined
                result.push({
                    key: config.key,
                    label: config.label,
                    isDynamic: !!config.isDynamic,
                    filterType: ft,
                    isActive,
                    catClass: isActive ? 'filter-cat filter-cat--active' : 'filter-cat',
                    hasSelections: !!filter,
                    values: [],
                });
                continue;
            }

            // Picklist checkbox filters
            const valueCounts = new Map();
            for (let i = 0, len = accounts.length; i < len; i++) {
                const val = getFieldValue(accounts[i], config, dynVals);
                valueCounts.set(val, (valueCounts.get(val) || 0) + 1);
            }

            if (valueCounts.size <= 1) continue;

            let sortedValues;
            if (config.order) {
                sortedValues = config.order.filter(v => valueCounts.has(v));
            } else {
                sortedValues = [...valueCounts.keys()].sort();
            }

            const selected = this.fieldFilters[config.key] || new Set();

            result.push({
                key: config.key,
                label: config.label,
                isDynamic: !!config.isDynamic,
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
            });
        }

        this._cachedFilterCats = result;
        this._fcDep1 = this.baseFilteredAccounts;
        this._fcDep2 = this.fieldFilters;
        this._fcDep3 = this.activeFilterCategory;
        this._fcDep4 = this.dynamicFieldValues;
        this._fcDep5 = this.dynamicFilterFields;
        return result;
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
        const which = event.currentTarget.dataset.which || 'value'; // 'value' or 'value2'
        const raw = event.target.value;
        const newFilters = { ...this.fieldFilters };
        const current = newFilters[key] || { operator: 'eq' };

        newFilters[key] = { ...current, [which]: raw };

        // Clean up: if operator-based filter has no value and isn't empty/notEmpty, remove it
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

    // ─── Computed: Reason Groups (memoized) ──────────────────────────────

    get reasonGroups() {
        if (this._rgDep1 === this.allAccounts
            && this._rgDep2 === this.activeFilter
            && this._rgDep3 === this.approvedIds
            && this._rgDep4 === this.rejectedIds
            && this._rgDep5 === this.activeReasonFilter
            && this._cachedReasonGroups) {
            return this._cachedReasonGroups;
        }

        if (!ACTIONABLE_ACTIONS.has(this.activeFilter)) {
            this._cachedReasonGroups = [];
            this._rgDep1 = this.allAccounts;
            this._rgDep2 = this.activeFilter;
            this._rgDep3 = this.approvedIds;
            this._rgDep4 = this.rejectedIds;
            this._rgDep5 = this.activeReasonFilter;
            return this._cachedReasonGroups;
        }

        const counts = {};
        const accts = this.allAccounts;
        const filter = this.activeFilter;
        const approved = this.approvedIds;
        const rejected = this.rejectedIds;

        for (let i = 0, len = accts.length; i < len; i++) {
            const a = accts[i];
            if (a.action === filter && !approved.has(a.id) && !rejected.has(a.id)) {
                const g = this._getRuleGroup(a);
                counts[g] = (counts[g] || 0) + 1;
            }
        }

        const result = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => ({
                label,
                count,
                isActive: this.activeReasonFilter === label,
                cssClass: this.activeReasonFilter === label
                    ? 'slds-badge slds-theme_success slds-m-right_xx-small'
                    : 'slds-badge slds-m-right_xx-small',
            }));

        this._cachedReasonGroups = result;
        this._rgDep1 = this.allAccounts;
        this._rgDep2 = this.activeFilter;
        this._rgDep3 = this.approvedIds;
        this._rgDep4 = this.rejectedIds;
        this._rgDep5 = this.activeReasonFilter;
        return result;
    }

    get hasReasonGroups() {
        return this.reasonGroups.length > 0;
    }

    // Cached ruleGroup lookup — computed once per account, reused everywhere
    _getRuleGroup(account) {
        let group = this._ruleGroupCache.get(account.id);
        if (group === undefined) {
            group = getRuleGroup(account);
            this._ruleGroupCache.set(account.id, group);
        }
        return group;
    }

    // ─── Computed: Datatable rows (optimized) ─────────────────────────────

    get datatableRows() {
        const filtered = this.filteredAccounts;
        const dynVals = this.dynamicFieldValues;
        const detailFields = this.dynamicDetailFields;
        const approved = this.approvedIds;

        // Rebuild base rows when underlying data changes (not on selection toggle)
        if (this._brDep1 !== filtered
            || this._brDep2 !== dynVals
            || this._brDep3 !== detailFields
            || this._brDep4 !== approved) {
            this._cachedBaseRows = this._buildBaseRows(filtered, dynVals, detailFields, approved);
            this._brDep1 = filtered;
            this._brDep2 = dynVals;
            this._brDep3 = detailFields;
            this._brDep4 = approved;
        }

        // Fast overlay: apply lightweight mutable state to cached base rows
        const isUnassignedAE = this.activeFilter === 'Unassigned AE';
        const isCurrentABX = this.activeFilter === 'Current ABX';
        const selected = this.selectedIds;
        const rejected = this.rejectedIds;
        const activeDropdown = this.activeAEDropdownId;
        const aeTerms = this.aeSearchTerms;
        const aeAssign = this.aeAssignments;
        const baseRows = this._cachedBaseRows;
        const rows = new Array(baseRows.length);

        for (let i = 0, len = baseRows.length; i < len; i++) {
            const base = baseRows[i];
            const id = base.id;
            const isApproved = approved.has(id);
            const isRejected = rejected.has(id);
            rows[i] = {
                ...base,
                isApproved,
                isRejected,
                isSelected: selected.has(id),
                isSelectable: base._isActionableType || isUnassignedAE || isCurrentABX,
                statusLabel: isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending',
                statusClass: isApproved ? 'slds-text-color_success' : isRejected ? 'slds-text-color_error' : '',
                aeSearchTerm: aeTerms[id] || '',
                showAEDropdown: activeDropdown === id,
                // Only compute filtered AE users for the single row with open dropdown
                filteredAEUsers: activeDropdown === id ? this._getFilteredAEUsers(id) : [],
                hasPendingAE: aeAssign.hasOwnProperty(id),
            };
        }
        return rows;
    }

    _buildBaseRows(filtered, dynVals, detailFields, approved) {
        const hasDetails = detailFields.length > 0;
        const rows = new Array(filtered.length);

        for (let i = 0, len = filtered.length; i < len; i++) {
            const a = filtered[i];
            const isActionableType = ACTIONABLE_ACTIONS.has(a.action);
            rows[i] = {
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
                _isActionableType: isActionableType,
                isActionable: isActionableType && !approved.has(a.id),
                ruleGroup: this._getRuleGroup(a),
                showRuleGroup: a.action !== 'No Change',
                dynamicDetails: hasDetails ? detailFields.map(f => {
                    const accountVals = dynVals[a.id];
                    let rawValue = accountVals ? accountVals[f.apiName] : null;
                    if (rawValue === true) rawValue = 'Yes';
                    else if (rawValue === false) rawValue = 'No';
                    return {
                        key: f.key,
                        label: f.label,
                        value: rawValue != null ? String(rawValue) : '—',
                    };
                }) : [],
                hasDynamicDetails: hasDetails,
            };
        }
        return rows;
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

    // ─── Filter stats bar handling ────────────────────────────────────────

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

    // ─── Search (debounced) ───────────────────────────────────────────────

    handleSearchChange(event) {
        const value = event.target.value;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
            this.searchTerm = value;
        }, 150);
    }

    handleClearSearch() {
        clearTimeout(this._searchTimer);
        this.searchTerm = '';
    }

    // ─── Approve / Reject handlers ────────────────────────────────────────

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

    // ─── Bulk actions ─────────────────────────────────────────────────────

    get isActionableFilter() {
        return ACTIONABLE_ACTIONS.has(this.activeFilter);
    }

    get isUnassignedAEFilter() {
        return this.activeFilter === 'Unassigned AE';
    }

    get isCurrentABXFilter() {
        return this.activeFilter === 'Current ABX';
    }

    get showInlineAESection() {
        return this.isCurrentABXFilter || this.isUnassignedAEFilter;
    }

    get showSelectAll() {
        return this.isActionableFilter || this.isUnassignedAEFilter || this.isCurrentABXFilter;
    }

    get actionableRows() {
        const approved = this.approvedIds;
        return this.filteredAccounts.filter(a =>
            ACTIONABLE_ACTIONS.has(a.action) && !approved.has(a.id)
        );
    }

    get selectableRows() {
        if (this.isUnassignedAEFilter || this.isCurrentABXFilter) return this.filteredAccounts;
        return this.actionableRows;
    }

    // Fast selectedCount using cached Set of selectable IDs
    get selectedCount() {
        const selectable = this.selectableRows;
        if (this._selDep1 !== selectable) {
            this._cachedSelectableIdSet = new Set(selectable.map(a => a.id));
            this._selDep1 = selectable;
        }
        let count = 0;
        for (const id of this.selectedIds) {
            if (this._cachedSelectableIdSet.has(id)) count++;
        }
        return count;
    }

    get hasSelection() {
        return this.selectedCount > 0;
    }

    get allSelected() {
        const rows = this.selectableRows;
        if (rows.length === 0) return false;
        const selected = this.selectedIds;
        for (let i = 0, len = rows.length; i < len; i++) {
            if (!selected.has(rows[i].id)) return false;
        }
        return true;
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

    // ─── Apply to Salesforce ──────────────────────────────────────────────

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
                this._invalidateCaches();
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

    // ─── Reset ────────────────────────────────────────────────────────────

    handleReset() {
        this._invalidateCaches();
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
        this.bulkUpdatePickerOpen = false;
        this.bulkUpdateSelectedField = null;
        this.bulkUpdateFieldSearch = '';
        this.bulkUpdateFieldValue = '';
    }

    // ─── Refresh ──────────────────────────────────────────────────────────

    async handleRefresh() {
        this.isLoading = true;
        this._invalidateCaches();
        this.approvedIds = new Set();
        this.rejectedIds = new Set();
        this.selectedIds = new Set();
        this.fieldFilters = {};
        this.aeAssignments = {};
        this.aeSearchTerms = {};
        this.activeAEDropdownId = null;
        this.bulkAEPickerOpen = false;
        this.bulkUpdatePickerOpen = false;
        this.bulkUpdateSelectedField = null;
        this.bulkUpdateFieldSearch = '';
        this.bulkUpdateFieldValue = '';
        await Promise.all([
            refreshApex(this._wiredAccountResult),
            refreshApex(this._wiredCampaignResult),
        ]);
    }

    // Invalidate all memoization caches
    _invalidateCaches() {
        this._cachedStats = null;
        this._cachedBaseFiltered = null;
        this._cachedFiltered = null;
        this._cachedFilterCats = null;
        this._cachedReasonGroups = null;
        this._cachedBaseRows = null;
        this._cachedSelectableIdSet = null;
        this._ruleGroupCache = new Map();
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

    // ─── Row expansion ────────────────────────────────────────────────────

    handleToggleExpand(event) {
        const id = event.currentTarget.dataset.id;
        const el = this.template.querySelector(`[data-detail-id="${id}"]`);
        if (el) {
            el.classList.toggle('slds-hide');
        }
    }

    // ─── AE Assignment ────────────────────────────────────────────────────

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

    // ─── Bulk Field Update ──────────────────────────────────────────────

    get filteredUpdateFields() {
        const queued = new Set(this.bulkUpdateQueue.map(q => q.apiName));
        let fields = this.accountFieldDescribe.filter(f => f.isUpdateable && !queued.has(f.apiName));
        if (this.bulkUpdateFieldSearch) {
            const q = this.bulkUpdateFieldSearch.toLowerCase();
            fields = fields.filter(f =>
                f.label.toLowerCase().includes(q) || f.apiName.toLowerCase().includes(q)
            );
        }
        return fields.slice(0, 30);
    }

    get hasBulkUpdateQueue() {
        return this.bulkUpdateQueue.length > 0;
    }

    get isBulkUpdatePicklist() {
        const f = this.bulkUpdateSelectedField;
        return f && (f.type === 'PICKLIST' || f.type === 'MULTIPICKLIST');
    }

    get isBulkUpdateBoolean() {
        const f = this.bulkUpdateSelectedField;
        return f && f.type === 'BOOLEAN';
    }

    get isBulkUpdateNumber() {
        const f = this.bulkUpdateSelectedField;
        return f && (f.type === 'DOUBLE' || f.type === 'CURRENCY' || f.type === 'PERCENT' || f.type === 'INTEGER');
    }

    get isBulkUpdateDate() {
        const f = this.bulkUpdateSelectedField;
        return f && (f.type === 'DATE' || f.type === 'DATETIME');
    }

    get isBulkUpdateText() {
        return this.bulkUpdateSelectedField
            && !this.isBulkUpdatePicklist
            && !this.isBulkUpdateBoolean
            && !this.isBulkUpdateNumber
            && !this.isBulkUpdateDate;
    }

    get bulkUpdatePicklistValues() {
        const f = this.bulkUpdateSelectedField;
        return f && f.picklistValues ? f.picklistValues : [];
    }

    get bulkUpdateBooleanValue() {
        return this.bulkUpdateFieldValue === 'true';
    }

    handleBulkUpdateClick() {
        this.bulkUpdatePickerOpen = !this.bulkUpdatePickerOpen;
        if (!this.bulkUpdatePickerOpen) {
            this.bulkUpdateSelectedField = null;
            this.bulkUpdateFieldSearch = '';
            this.bulkUpdateFieldValue = '';
            this.bulkUpdateQueue = [];
        }
    }

    handleBulkUpdateFieldSearch(event) {
        this.bulkUpdateFieldSearch = event.target.value;
    }

    handleBulkUpdateFieldSelect(event) {
        const apiName = event.currentTarget.dataset.apiName;
        const field = this.accountFieldDescribe.find(f => f.apiName === apiName);
        if (!field) return;
        this.bulkUpdateSelectedField = field;
        this.bulkUpdateFieldValue = '';
    }

    handleBulkUpdateFieldClear() {
        this.bulkUpdateSelectedField = null;
        this.bulkUpdateFieldSearch = '';
        this.bulkUpdateFieldValue = '';
    }

    handleBulkUpdateValueChange(event) {
        this.bulkUpdateFieldValue = event.target.value != null ? String(event.target.value) : '';
    }

    handleBulkUpdateToggle(event) {
        this.bulkUpdateFieldValue = event.target.checked ? 'true' : 'false';
    }

    handleBulkUpdateAddToQueue() {
        const field = this.bulkUpdateSelectedField;
        if (!field) return;
        // Build a display-friendly value
        const raw = this.bulkUpdateFieldValue;
        let displayValue = raw;
        if (field.type === 'BOOLEAN') {
            displayValue = raw === 'true' ? 'True' : 'False';
        } else if (!raw) {
            displayValue = '(empty)';
        }
        this.bulkUpdateQueue = [
            ...this.bulkUpdateQueue,
            { apiName: field.apiName, label: field.label, value: raw, displayValue },
        ];
        // Reset field selection so user can pick another
        this.bulkUpdateSelectedField = null;
        this.bulkUpdateFieldSearch = '';
        this.bulkUpdateFieldValue = '';
    }

    handleBulkUpdateRemoveFromQueue(event) {
        const apiName = event.currentTarget.dataset.apiName;
        this.bulkUpdateQueue = this.bulkUpdateQueue.filter(q => q.apiName !== apiName);
    }

    handleBulkUpdateClose() {
        this.bulkUpdatePickerOpen = false;
        this.bulkUpdateSelectedField = null;
        this.bulkUpdateFieldSearch = '';
        this.bulkUpdateFieldValue = '';
        this.bulkUpdateQueue = [];
    }

    async handleBulkUpdateApply() {
        if (!this.bulkUpdateQueue.length) return;
        const accountIds = [...this.selectedIds];
        if (!accountIds.length) return;

        // Build fieldName → fieldValue map from the queue
        const fieldUpdates = {};
        for (const item of this.bulkUpdateQueue) {
            fieldUpdates[item.apiName] = item.value;
        }

        this.isBulkUpdating = true;
        try {
            const result = await bulkUpdateAccountFields({
                fieldUpdatesJson: JSON.stringify(fieldUpdates),
                accountIds,
            });
            if (result.ok) {
                const fieldLabels = this.bulkUpdateQueue.map(q => q.label).join(', ');
                this.showToast('Success',
                    `Updated ${fieldLabels} on ${result.updated} accounts.`, 'success');
                this.bulkUpdatePickerOpen = false;
                this.bulkUpdateSelectedField = null;
                this.bulkUpdateFieldSearch = '';
                this.bulkUpdateFieldValue = '';
                this.bulkUpdateQueue = [];
                this.selectedIds = new Set();
                this._invalidateCaches();
                await refreshApex(this._wiredAccountResult);
            } else {
                this.showToast('Warning',
                    `Partial update with errors: ${result.errors.join('; ')}`, 'warning');
            }
        } catch (error) {
            this.showToast('Error', 'Bulk update failed: ' + this.reduceErrors(error), 'error');
        } finally {
            this.isBulkUpdating = false;
        }
    }

    // ─── Dynamic Field Pickers ────────────────────────────────────────────

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

    // ─── Backdrop overlay (close-on-click-outside) ───────────────────────
    // Uses an invisible full-screen backdrop div instead of document click
    // listener + composedPath(), which doesn't work in LWC shadow DOM.

    get hasAnyOverlay() {
        return this.filterPanelOpen || !!this.activeAEDropdownId || this.bulkAEPickerOpen
            || this.showDynamicFieldPicker || this.showDetailFieldPicker
            || this.bulkUpdatePickerOpen;
    }

    handleBackdropClick() {
        if (this.filterPanelOpen) {
            this.filterPanelOpen = false;
        }
        if (this.showDynamicFieldPicker) {
            this.showDynamicFieldPicker = false;
        }
        if (this.showDetailFieldPicker) {
            this.showDetailFieldPicker = false;
        }
        if (this.activeAEDropdownId) {
            const closingId = this.activeAEDropdownId;
            this.activeAEDropdownId = null;
            const newTerms = { ...this.aeSearchTerms };
            delete newTerms[closingId];
            this.aeSearchTerms = newTerms;
            const newAssign = { ...this.aeAssignments };
            delete newAssign[closingId];
            this.aeAssignments = newAssign;
        }
        if (this.bulkAEPickerOpen) {
            this.bulkAEPickerOpen = false;
        }
        if (this.bulkUpdatePickerOpen) {
            this.bulkUpdatePickerOpen = false;
            this.bulkUpdateSelectedField = null;
            this.bulkUpdateFieldSearch = '';
            this.bulkUpdateFieldValue = '';
        }
    }

    disconnectedCallback() {
        clearTimeout(this._searchTimer);
    }

    // ─── Utilities ────────────────────────────────────────────────────────

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
