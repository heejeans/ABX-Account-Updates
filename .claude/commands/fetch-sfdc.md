# Fetch Salesforce Data

Fetch fresh account data from Salesforce using the Sweep MCP connector and update the server cache.

## Steps

1. Run all 4 SOQL query groups below using the `run-soql` MCP tool (one batch at a time, LIMIT 200, paginating with OFFSET then keyset pagination after OFFSET 2000).

2. Deduplicate records by `Id` across all groups.

3. Write the combined array to `data/raw-accounts.json`.

4. Call `POST http://localhost:3000/api/reload` to update the live cache.

5. Report the total count.

## SOQL Queries

**Group 1** — Currently tiered + all Closed Lost:
```
SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND (ABX_Tier__c != null OR Account_Stage__c = 'Closed Lost') ORDER BY Name LIMIT 200 OFFSET {N}
```

**Group 2** — Prospect candidates (no tier):
```
SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' ORDER BY Name LIMIT 200 OFFSET {N}
```

**Group 3** — Old Closed Lost (before Aug 1 2025, no tier):
```
SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Fit_Score_Total__c >= 5 AND Account_Intent__c != null AND Account_Intent__c != 'None' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND Account_Stage__c = 'Closed Lost' AND Entered_Closed_Lost_Date__c < 2025-08-01 AND Sales_Segment__c != 'Commercial' ORDER BY Name LIMIT 200 OFFSET {N}
```

**Group 4** — DNN/Marketplace Prospects without tier (low/no fit or intent):
```
SELECT Id, Name, ABX_Tier__c, Fit_Score_Total__c, Account_Intent__c, Account_Stage__c, Sales_Segment__c, Marketplace_Prospect__c, Consulting_IT_Filter_Flow__c, Company_isDefunct__c, Qualified_Out_Detail__c, Qualified_Out_Date__c, Qualified_Out_Reason__c, ParentId, Entered_Closed_Lost_Date__c FROM Account WHERE IsDeleted = false AND ABX_Tier__c = null AND Marketplace_Prospect__c = true AND Account_Stage__c = 'Prospect' AND Sales_Segment__c != 'Commercial' AND ParentId = null AND Qualified_Out_Detail__c = null AND Qualified_Out_Date__c = null AND Qualified_Out_Reason__c = null AND Company_isDefunct__c != 'true' AND Consulting_IT_Filter_Flow__c = false AND (Fit_Score_Total__c < 5 OR Fit_Score_Total__c = null OR Account_Intent__c = null OR Account_Intent__c = 'None') ORDER BY Name LIMIT 200 OFFSET {N}
```

## Notes

- Salesforce limits `OFFSET` to 2000. After hitting that limit, switch to keyset pagination: `AND Name > '{lastFetchedName}'` with `OFFSET 0`.
- Each `run-soql` result comes in `query_result` array. Stop a group when fewer than 200 records are returned.
- Group 3 is typically fully covered by Group 1 (no new records).
- Write results with: `fs.writeFileSync('data/raw-accounts.json', JSON.stringify(records))`
- Then reload: `curl -X POST http://localhost:3000/api/reload`
