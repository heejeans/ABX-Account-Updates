/**
 * ABXTierReviewController — @AuraEnabled methods for the ABX Tier Review LWC.
 *
 * Provides:
 *  - getAccountReviewData()      → SOQL + tiering evaluation for the review tab
 *  - getCampaignSyncData()       → Campaign + CampaignMember data for the sync tab
 *  - applyTierChanges(json)      → DML to update ABX_Tier__c / ABX_Account__c
 *  - syncCampaignMembership(json)→ Insert / delete CampaignMember records
 *  - getAEUsers()                → Active Users for AE assignment picker
 *  - assignAccountExecutives(json)→ Update Account_Executive_Owner__c on Accounts
 *  - getAccountFieldDescribe()   → Schema describe for dynamic field lookup
 *  - getDynamicFieldValues(...)   → Fetch arbitrary field values for accounts
 */
public with sharing class ABXTierReviewController {

    // The active ABX campaign Id — 2025_09_ABX_Accounts
    private static final Id ABX_CAMPAIGN_ID = '701VN00000VpEWvYAN';

    // Fields queried for every Account in the review
    private static final String ACCOUNT_FIELDS =
        'Id, Name, ABX_Tier__c, ABX_Account__c, ABX_Start_Date__c, ' +
        'Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, ' +
        'Sales_Segment__c, Marketplace_Prospect__c, ' +
        'Consulting_IT_Filter_Flow__c, Company_isDefunct__c, ' +
        'Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ' +
        'ParentId, Entered_Closed_Lost_Date__c, ' +
        'AE_Territory__c, Account_Executive_Owner__c, Account_Executive_Owner__r.Name, ' +
        'Account_Development_Owner__c, Account_Development_Owner__r.Name';

    // ─── Wrapper classes ──────────────────────────────────────────────────────────

    public class AccountWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String action;
        @AuraEnabled public String currentTier;
        @AuraEnabled public String recommendedTier;
        @AuraEnabled public String reason;
        @AuraEnabled public String intentLevel;
        @AuraEnabled public Decimal fitScore;
        @AuraEnabled public String intent;
        @AuraEnabled public String stage;
        @AuraEnabled public String segment;
        @AuraEnabled public Boolean isDnn;
        @AuraEnabled public Boolean isDefunct;
        @AuraEnabled public String closedLostDate;
        @AuraEnabled public String parentId;
        @AuraEnabled public Boolean abxAccount;
        @AuraEnabled public String abxStartDate;
        @AuraEnabled public String aeTerritory;
        @AuraEnabled public String accountExecutiveId;
        @AuraEnabled public String accountExecutiveName;
        @AuraEnabled public String accountDevOwnerId;
        @AuraEnabled public String accountDevOwnerName;
    }

    public class ReviewData {
        @AuraEnabled public List<AccountWrapper> accounts;
        @AuraEnabled public Integer totalAccounts;
    }

    public class CampaignSyncData {
        @AuraEnabled public String campaignId;
        @AuraEnabled public String campaignName;
        @AuraEnabled public Integer memberCount;
        @AuraEnabled public List<CampaignMemberWrapper> members;
    }

    public class CampaignMemberWrapper {
        @AuraEnabled public String memberId;
        @AuraEnabled public String accountId;
        @AuraEnabled public String accountName;
        @AuraEnabled public String status;
        @AuraEnabled public String engagementDate;
    }

    public class ChangeRequest {
        @AuraEnabled public String accountId;
        @AuraEnabled public String action;    // Add, Remove, Reclassify
        @AuraEnabled public String tier;      // Tier 1, Tier 2, Tier 3, or null
    }

    public class FieldDescribeResult {
        @AuraEnabled public String apiName;
        @AuraEnabled public String label;
        @AuraEnabled public String type;
    }

    public class AEUserOption {
        @AuraEnabled public String userId;
        @AuraEnabled public String name;
    }

    public class AEAssignmentRequest {
        @AuraEnabled public String accountId;
        @AuraEnabled public String userId;
    }

    public class ApplyResult {
        @AuraEnabled public Boolean ok;
        @AuraEnabled public Integer added;
        @AuraEnabled public Integer removed;
        @AuraEnabled public Integer updated;
        @AuraEnabled public List<String> errors;
    }

    // ─── Review Data ──────────────────────────────────────────────────────────────

    /**
     * Fetch all accounts relevant to ABX review, run tiering evaluation,
     * and return enriched wrappers.
     *
     * Single comprehensive query with NO pre-filters — the ABXTierService
     * handles all exclusion/classification logic in Apex. This avoids SOQL
     * null-handling gotchas (e.g. != 'value' excludes nulls) that can cause
     * accounts to be silently dropped.
     *
     * Fetches:
     *  - All currently tiered accounts (Remove / Reclassify / No Change)
     *  - All Closed Lost accounts (re-targeting evaluation)
     *  - Prospect candidates with fit+intent or DNN flag (potential Adds)
     */
    @AuraEnabled(cacheable=true)
    public static ReviewData getAccountReviewData() {

        String soql =
            'SELECT ' + ACCOUNT_FIELDS +
            ' FROM Account' +
            ' WHERE ABX_Tier__c != null' +
            '    OR Account_Stage__c = \'Closed Lost\'' +
            '    OR (Account_Stage__c = \'Prospect\'' +
            '        AND (' +
            '          (Fit_Score_Total__c >= 5' +
            '           AND Account_Intent__c != null' +
            '           AND Account_Intent__c != \'None\')' +
            '          OR Marketplace_Prospect__c = true' +
            '        ))' +
            ' ORDER BY Name';
        List<Account> rawAccounts = Database.query(soql);

        List<ABXTierService.TierEvaluation> evaluations = ABXTierService.processAccounts(rawAccounts);

        List<AccountWrapper> wrappers = new List<AccountWrapper>();
        for (Integer i = 0; i < rawAccounts.size(); i++) {
            Account acct = rawAccounts[i];
            ABXTierService.TierEvaluation eval = evaluations[i];

            AccountWrapper w = new AccountWrapper();
            w.id              = acct.Id;
            w.name            = acct.Name;
            w.action          = eval.action;
            w.currentTier     = eval.currentTier;
            w.recommendedTier = eval.recommendedTier;
            w.reason          = eval.reason;
            w.intentLevel     = eval.intentLevel;
            w.fitScore        = acct.Fit_Score_Total__c;
            w.intent          = acct.Account_Intent__c;
            w.stage           = acct.Account_Stage__c;
            w.segment         = acct.Sales_Segment__c;
            w.isDnn           = (acct.Marketplace_Prospect__c == true);
            w.isDefunct       = (acct.Company_isDefunct__c != null && acct.Company_isDefunct__c.equalsIgnoreCase('true'));
            w.closedLostDate  = acct.Entered_Closed_Lost_Date__c != null
                                  ? String.valueOf(acct.Entered_Closed_Lost_Date__c)
                                  : null;
            w.parentId        = acct.ParentId;
            w.abxAccount      = (acct.ABX_Account__c == true);
            w.abxStartDate    = acct.ABX_Start_Date__c != null
                                  ? String.valueOf(acct.ABX_Start_Date__c)
                                  : null;
            w.aeTerritory          = acct.AE_Territory__c;
            w.accountExecutiveId   = acct.Account_Executive_Owner__c;
            w.accountExecutiveName = acct.Account_Executive_Owner__r != null
                                       ? acct.Account_Executive_Owner__r.Name
                                       : null;
            w.accountDevOwnerId    = acct.Account_Development_Owner__c;
            w.accountDevOwnerName  = acct.Account_Development_Owner__r != null
                                       ? acct.Account_Development_Owner__r.Name
                                       : null;
            wrappers.add(w);
        }

        ReviewData result = new ReviewData();
        result.accounts = wrappers;
        result.totalAccounts = wrappers.size();
        return result;
    }

    // ─── Campaign Sync Data ───────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CampaignSyncData getCampaignSyncData() {
        Campaign camp = [
            SELECT Id, Name
            FROM Campaign
            WHERE Id = :ABX_CAMPAIGN_ID
            LIMIT 1
        ];

        // Query CampaignMembers — this is an Account-based campaign.
        // CampaignMember.AccountId stores the Account Id directly.
        List<CampaignMember> members = [
            SELECT Id, AccountId, Account.Name, Status, algnatt__Engagement_Date__c
            FROM CampaignMember
            WHERE CampaignId = :ABX_CAMPAIGN_ID
              AND AccountId != null
            ORDER BY Account.Name
        ];

        // Build member wrappers, deduplicated by Account
        List<CampaignMemberWrapper> memberWrappers = new List<CampaignMemberWrapper>();
        Set<Id> seenAccountIds = new Set<Id>();
        for (CampaignMember cm : members) {
            if (seenAccountIds.contains(cm.AccountId)) continue;
            seenAccountIds.add(cm.AccountId);

            CampaignMemberWrapper mw = new CampaignMemberWrapper();
            mw.memberId    = cm.Id;
            mw.accountId   = cm.AccountId;
            mw.accountName = cm.Account?.Name;
            mw.status      = cm.Status;
            mw.engagementDate = cm.algnatt__Engagement_Date__c != null
                                  ? String.valueOf(cm.algnatt__Engagement_Date__c)
                                  : null;
            memberWrappers.add(mw);
        }

        CampaignSyncData data = new CampaignSyncData();
        data.campaignId   = camp.Id;
        data.campaignName = camp.Name;
        data.memberCount  = memberWrappers.size();
        data.members      = memberWrappers;
        return data;
    }

    // ─── Apply Tier Changes ───────────────────────────────────────────────────────

    /**
     * Apply approved tier changes to Account records.
     * Accepts a JSON array of ChangeRequest objects.
     *
     * For "Add" and "Reclassify": sets ABX_Tier__c and ABX_Account__c = true.
     * For "Remove": clears ABX_Tier__c and sets ABX_Account__c = false.
     */
    @AuraEnabled
    public static ApplyResult applyTierChanges(String changesJson) {
        List<ChangeRequest> changes = (List<ChangeRequest>) JSON.deserialize(
            changesJson, List<ChangeRequest>.class
        );

        Set<Id> accountIds = new Set<Id>();
        for (ChangeRequest cr : changes) {
            accountIds.add(cr.accountId);
        }

        Map<Id, Account> accountMap = new Map<Id, Account>([
            SELECT Id, ABX_Tier__c, ABX_Account__c, ABX_Start_Date__c
            FROM Account
            WHERE Id IN :accountIds
        ]);

        List<Account> toUpdate = new List<Account>();
        Integer added = 0, removed = 0, updated = 0;
        List<String> errors = new List<String>();

        for (ChangeRequest cr : changes) {
            Account acct = accountMap.get(cr.accountId);
            if (acct == null) {
                errors.add('Account not found: ' + cr.accountId);
                continue;
            }

            if (cr.action == 'Add') {
                acct.ABX_Tier__c = cr.tier;
                acct.ABX_Account__c = true;
                if (acct.ABX_Start_Date__c == null) {
                    acct.ABX_Start_Date__c = Datetime.now();
                }
                toUpdate.add(acct);
                added++;
            } else if (cr.action == 'Remove') {
                acct.ABX_Tier__c = null;
                acct.ABX_Account__c = false;
                toUpdate.add(acct);
                removed++;
            } else if (cr.action == 'Reclassify') {
                acct.ABX_Tier__c = cr.tier;
                acct.ABX_Account__c = true;
                toUpdate.add(acct);
                updated++;
            } else {
                errors.add('Unknown action "' + cr.action + '" for ' + cr.accountId);
            }
        }

        if (!toUpdate.isEmpty()) {
            List<Database.SaveResult> results = Database.update(toUpdate, false);
            for (Integer i = 0; i < results.size(); i++) {
                if (!results[i].isSuccess()) {
                    for (Database.Error err : results[i].getErrors()) {
                        errors.add('Update failed for ' + toUpdate[i].Id + ': ' + err.getMessage());
                    }
                }
            }
        }

        ApplyResult result = new ApplyResult();
        result.ok      = errors.isEmpty();
        result.added   = added;
        result.removed = removed;
        result.updated = updated;
        result.errors  = errors;
        return result;
    }

    // ─── Sync Campaign Membership ─────────────────────────────────────────────────

    /**
     * Sync campaign membership: add or remove CampaignMember records.
     * Accepts a JSON array: [{ accountId, action: "Add"|"Remove" }]
     *
     * This is an Account-based campaign — LeadOrContactId stores Account IDs directly.
     * For "Add": inserts CampaignMember with LeadOrContactId = Account Id.
     * For "Remove": deletes existing CampaignMembers matching the Account Id.
     */
    @AuraEnabled
    public static ApplyResult syncCampaignMembership(String changesJson) {
        List<ChangeRequest> changes = (List<ChangeRequest>) JSON.deserialize(
            changesJson, List<ChangeRequest>.class
        );

        List<String> errors = new List<String>();
        Integer added = 0, removed = 0;

        // Separate adds vs removes
        Set<Id> addAccountIds = new Set<Id>();
        Set<Id> removeAccountIds = new Set<Id>();

        for (ChangeRequest cr : changes) {
            if (cr.action == 'Add') {
                addAccountIds.add(cr.accountId);
            } else if (cr.action == 'Remove') {
                removeAccountIds.add(cr.accountId);
            }
        }

        // ── Handle Adds: Account-based campaign — set AccountId directly ──
        if (!addAccountIds.isEmpty()) {
            List<CampaignMember> toInsert = new List<CampaignMember>();
            for (Id acctId : addAccountIds) {
                CampaignMember cm = new CampaignMember();
                cm.CampaignId = ABX_CAMPAIGN_ID;
                cm.AccountId  = acctId;
                cm.Status     = 'Sent';
                toInsert.add(cm);
                added++;
            }

            if (!toInsert.isEmpty()) {
                List<Database.SaveResult> results = Database.insert(toInsert, false);
                for (Integer i = 0; i < results.size(); i++) {
                    if (!results[i].isSuccess()) {
                        added--;
                        for (Database.Error err : results[i].getErrors()) {
                            errors.add('Campaign add failed: ' + err.getMessage());
                        }
                    }
                }
            }
        }

        // ── Handle Removes: Account-based campaign — match on AccountId ──
        if (!removeAccountIds.isEmpty()) {
            List<CampaignMember> toDelete = [
                SELECT Id
                FROM CampaignMember
                WHERE CampaignId = :ABX_CAMPAIGN_ID
                  AND AccountId IN :removeAccountIds
            ];
            removed = toDelete.size();

            if (!toDelete.isEmpty()) {
                List<Database.DeleteResult> results = Database.delete(toDelete, false);
                for (Integer i = 0; i < results.size(); i++) {
                    if (!results[i].isSuccess()) {
                        removed--;
                        for (Database.Error err : results[i].getErrors()) {
                            errors.add('Campaign remove failed: ' + err.getMessage());
                        }
                    }
                }
            }
        }

        ApplyResult result = new ApplyResult();
        result.ok      = errors.isEmpty();
        result.added   = added;
        result.removed = removed;
        result.updated = 0;
        result.errors  = errors;
        return result;
    }

    // ─── AE User List ────────────────────────────────────────────────────────────

    /**
     * Returns active standard Users for the AE assignment picker.
     * Cacheable so the LWC only fetches once per session.
     */
    @AuraEnabled(cacheable=true)
    public static List<AEUserOption> getAEUsers() {
        List<AEUserOption> options = new List<AEUserOption>();
        for (User u : [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true
              AND UserType = 'Standard'
            ORDER BY Name
            LIMIT 500
        ]) {
            AEUserOption opt = new AEUserOption();
            opt.userId = u.Id;
            opt.name   = u.Name;
            options.add(opt);
        }
        return options;
    }

    // ─── Assign Account Executives ───────────────────────────────────────────────

    /**
     * Assign Account Executive owners to Accounts.
     * Accepts a JSON array: [{ accountId, userId }]
     * userId can be null to clear the assignment.
     */
    @AuraEnabled
    public static ApplyResult assignAccountExecutives(String assignmentsJson) {
        List<AEAssignmentRequest> assignments = (List<AEAssignmentRequest>) JSON.deserialize(
            assignmentsJson, List<AEAssignmentRequest>.class
        );

        Set<Id> accountIds = new Set<Id>();
        for (AEAssignmentRequest ar : assignments) {
            accountIds.add(ar.accountId);
        }

        Map<Id, Account> accountMap = new Map<Id, Account>([
            SELECT Id, Account_Executive_Owner__c
            FROM Account
            WHERE Id IN :accountIds
        ]);

        List<Account> toUpdate = new List<Account>();
        Integer updated = 0;
        List<String> errors = new List<String>();

        for (AEAssignmentRequest ar : assignments) {
            Account acct = accountMap.get(ar.accountId);
            if (acct == null) {
                errors.add('Account not found: ' + ar.accountId);
                continue;
            }
            acct.Account_Executive_Owner__c = ar.userId;
            toUpdate.add(acct);
            updated++;
        }

        if (!toUpdate.isEmpty()) {
            List<Database.SaveResult> results = Database.update(toUpdate, false);
            for (Integer i = 0; i < results.size(); i++) {
                if (!results[i].isSuccess()) {
                    updated--;
                    for (Database.Error err : results[i].getErrors()) {
                        errors.add('AE assignment failed for ' + toUpdate[i].Id + ': ' + err.getMessage());
                    }
                }
            }
        }

        ApplyResult result = new ApplyResult();
        result.ok      = errors.isEmpty();
        result.added   = 0;
        result.removed = 0;
        result.updated = updated;
        result.errors  = errors;
        return result;
    }

    // ─── Dynamic Field Describe ─────────────────────────────────────────────────

    /**
     * Returns field metadata for all accessible Account fields.
     * Used by the LWC to build a searchable field picker for dynamic filters/details.
     */
    @AuraEnabled(cacheable=true)
    public static List<FieldDescribeResult> getAccountFieldDescribe() {
        List<FieldDescribeResult> results = new List<FieldDescribeResult>();
        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Account.fields.getMap();

        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
            if (!dfr.isAccessible()) continue;

            FieldDescribeResult fdr = new FieldDescribeResult();
            fdr.apiName = dfr.getName();
            fdr.label   = dfr.getLabel();
            fdr.type    = String.valueOf(dfr.getType());
            results.add(fdr);
        }

        return results;
    }

    // ─── Dynamic Field Values ───────────────────────────────────────────────────

    /**
     * Fetch arbitrary field values for a set of Accounts.
     * Field names are validated against the Account describe to prevent SOQL injection.
     * Reference/lookup fields auto-resolve to the related record's Name.
     */
    @AuraEnabled
    public static Map<Id, Map<String, Object>> getDynamicFieldValues(
        List<String> fieldNames, List<Id> accountIds
    ) {
        if (fieldNames == null || fieldNames.isEmpty() || accountIds == null || accountIds.isEmpty()) {
            return new Map<Id, Map<String, Object>>();
        }

        Map<String, Schema.SObjectField> fieldMap = Schema.SObjectType.Account.fields.getMap();
        List<String> validFields = new List<String>();

        for (String f : fieldNames) {
            String lower = f.toLowerCase();
            if (fieldMap.containsKey(lower) && fieldMap.get(lower).getDescribe().isAccessible()) {
                validFields.add(fieldMap.get(lower).getDescribe().getName());
            }
        }

        if (validFields.isEmpty()) {
            return new Map<Id, Map<String, Object>>();
        }

        // Build query fields — for lookups, also fetch the relationship Name
        Set<String> queryFields = new Set<String>{ 'Id' };
        for (String f : validFields) {
            queryFields.add(f);
            Schema.DescribeFieldResult dfr = fieldMap.get(f.toLowerCase()).getDescribe();
            if (dfr.getType() == Schema.DisplayType.REFERENCE) {
                String relName = dfr.getRelationshipName();
                if (relName != null) {
                    queryFields.add(relName + '.Name');
                }
            }
        }

        String soql = 'SELECT ' + String.join(new List<String>(queryFields), ', ') +
                       ' FROM Account WHERE Id IN :accountIds';
        List<Account> accounts = Database.query(soql);

        Map<Id, Map<String, Object>> result = new Map<Id, Map<String, Object>>();
        for (Account acct : accounts) {
            Map<String, Object> values = new Map<String, Object>();
            for (String f : validFields) {
                Schema.DescribeFieldResult dfr = fieldMap.get(f.toLowerCase()).getDescribe();
                if (dfr.getType() == Schema.DisplayType.REFERENCE) {
                    String relName = dfr.getRelationshipName();
                    if (relName != null) {
                        try {
                            SObject related = acct.getSObject(relName);
                            values.put(f, related != null ? (Object) related.get('Name') : null);
                        } catch (Exception e) {
                            values.put(f, acct.get(f));
                        }
                    } else {
                        values.put(f, acct.get(f));
                    }
                } else {
                    values.put(f, acct.get(f));
                }
            }
            result.put(acct.Id, values);
        }

        return result;
    }
}
