@isTest
private class ABXTierServiceTest {

    // ─── Helper: build an Account with defaults ──────────────────────────────────
    // Account_Stage__c and Fit_Score_Total__c are formula fields and cannot be set
    // via direct assignment or put(). We use JSON.deserialize to create in-memory
    // Account objects with formula field values for unit testing.

    private static Account buildAccount(Map<String, Object> overrides) {
        Map<String, Object> defaults = new Map<String, Object>{
            'Name' => 'Test Account',
            'Type' => 'Standard',
            'Account_Stage__c' => 'Prospect',
            'Sales_Segment__c' => 'Enterprise',
            'Company_isDefunct__c' => 'false',
            'Consulting_IT_Filter_Flow__c' => false,
            'Marketplace_Prospect__c' => false
        };
        if (overrides != null) {
            defaults.putAll(overrides);
        }
        return (Account) JSON.deserialize(JSON.serialize(defaults), Account.class);
    }

    // ─── classifyIntent tests ────────────────────────────────────────────────────

    @isTest
    static void testClassifyIntent_NullReturnsLow() {
        System.assertEquals('Low', ABXTierService.classifyIntent(null));
    }

    @isTest
    static void testClassifyIntent_NoneReturnsLow() {
        System.assertEquals('Low', ABXTierService.classifyIntent('None'));
    }

    @isTest
    static void testClassifyIntent_EmptyReturnsLow() {
        System.assertEquals('Low', ABXTierService.classifyIntent(''));
    }

    @isTest
    static void testClassifyIntent_HighKeyword() {
        System.assertEquals('High', ABXTierService.classifyIntent('High'));
        System.assertEquals('High', ABXTierService.classifyIntent('Very High'));
        System.assertEquals('High', ABXTierService.classifyIntent('high intent'));
    }

    @isTest
    static void testClassifyIntent_MediumKeyword() {
        System.assertEquals('Medium', ABXTierService.classifyIntent('Medium'));
        System.assertEquals('Medium', ABXTierService.classifyIntent('Moderate'));
    }

    @isTest
    static void testClassifyIntent_LowKeyword() {
        System.assertEquals('Low', ABXTierService.classifyIntent('Low'));
    }

    @isTest
    static void testClassifyIntent_UnknownNonEmptyReturnsMedium() {
        System.assertEquals('Medium', ABXTierService.classifyIntent('Some intent value'));
    }

    // ─── Exclusion tests ─────────────────────────────────────────────────────────

    @isTest
    static void testExclusion_ParentAccount() {
        Account a = buildAccount(new Map<String, Object>{
            'ParentId' => '001000000000001AAA'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('parent account'), 'Reason should mention parent: ' + eval.reason);
    }

    @isTest
    static void testExclusion_ParentAccountWithTier_Remove() {
        Account a = buildAccount(new Map<String, Object>{
            'ParentId' => '001000000000001AAA',
            'ABX_Tier__c' => 'Tier 2'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Remove', eval.action);
        System.assertEquals('Tier 2', eval.currentTier);
        System.assertEquals(null, eval.recommendedTier);
    }

    @isTest
    static void testExclusion_DefunctCompany() {
        Account a = buildAccount(new Map<String, Object>{
            'Company_isDefunct__c' => 'true'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('defunct'), 'Reason should mention defunct');
    }

    @isTest
    static void testExclusion_QualifiedOut() {
        Account a = buildAccount(new Map<String, Object>{
            'Qualified_Out_Reason__c' => 'Too small'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('Qualified out'), 'Reason should mention qualified out');
    }

    @isTest
    static void testExclusion_ConsultingIT() {
        Account a = buildAccount(new Map<String, Object>{
            'Consulting_IT_Filter_Flow__c' => true
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('Consulting/IT'), 'Reason should mention consulting');
    }

    @isTest
    static void testExclusion_ExcludedStage() {
        Account a = buildAccount(new Map<String, Object>{
            'Account_Stage__c' => 'Customer'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('excluded from tiering'), 'Reason should mention excluded stage');
    }

    @isTest
    static void testExclusion_CommercialSegment() {
        Account a = buildAccount(new Map<String, Object>{
            'Sales_Segment__c' => 'Commercial'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('Commercial'), 'Reason should mention Commercial');
    }

    @isTest
    static void testExclusion_MidMarketSegment() {
        Account a = buildAccount(new Map<String, Object>{
            'Sales_Segment__c' => 'Mid-Market'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('Mid-Market'), 'Reason should mention Mid-Market');
    }

    @isTest
    static void testExclusion_AccountTypeNotStandard() {
        Account a = buildAccount(new Map<String, Object>{
            'Type' => 'Partner'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('must be Standard'), 'Reason should mention must be Standard');
    }

    @isTest
    static void testExclusion_AccountTypeNull() {
        Account a = buildAccount(new Map<String, Object>{
            'Type' => null
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('(blank)'), 'Reason should mention blank type');
    }

    @isTest
    static void testExclusion_AccountTypeStandard_NotExcluded() {
        Account a = buildAccount(new Map<String, Object>{
            'Type' => 'Standard',
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertNotEquals('Ignore', eval.action, 'Standard type should not be excluded');
        System.assert(!eval.reason.contains('Account type'), 'Should not mention account type exclusion');
    }

    // ─── Closed Lost routing tests ───────────────────────────────────────────────

    @isTest
    static void testClosedLost_RecentWithTier_Remove() {
        Account a = buildAccount(new Map<String, Object>{
            'Account_Stage__c' => 'Closed Lost',
            'ABX_Tier__c' => 'Tier 1',
            'Entered_Closed_Lost_Date__c' => Date.today().addMonths(-2)
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Remove', eval.action);
        System.assert(eval.reason.contains('Closed Lost'), 'Should mention Closed Lost');
        System.assert(eval.reason.contains('within the past 6 months'), 'Should mention 6-month window');
    }

    @isTest
    static void testClosedLost_RecentNoTier_Ignore() {
        Account a = buildAccount(new Map<String, Object>{
            'Account_Stage__c' => 'Closed Lost',
            'Entered_Closed_Lost_Date__c' => Date.today().addMonths(-1)
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assert(eval.reason.contains('Too recent'), 'Should mention too recent');
    }

    @isTest
    static void testClosedLost_OldFallsToMatrix() {
        Account a = buildAccount(new Map<String, Object>{
            'Account_Stage__c' => 'Closed Lost',
            'Entered_Closed_Lost_Date__c' => Date.today().addMonths(-9),
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 1', eval.recommendedTier);
        System.assert(eval.reason.contains('eligible for re-targeting'), 'Should mention re-targeting');
    }

    // ─── Tiering matrix tests ────────────────────────────────────────────────────

    @isTest
    static void testMatrix_HighFitHighIntent_Tier1() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 1', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_HighFitMedIntent_Tier2() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'Medium'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_HighFitLowIntent_Tier3() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'Low'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 3', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_MidFit11_HighIntent_Tier2() {
        // Fit 11 now falls in 9-11 range → High intent = Tier 2
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 11,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_MidFitHighIntent_Tier2() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 10,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_MidFitMedIntent_Tier3() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 9,
            'Account_Intent__c' => 'Medium'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 3', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_MidFitLowIntent_Ignore() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 9,
            'Account_Intent__c' => 'Low'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
        System.assertEquals(null, eval.recommendedTier);
    }

    @isTest
    static void testMatrix_LowFitHighIntent_Tier3() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 7,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 3', eval.recommendedTier);
    }

    @isTest
    static void testMatrix_LowFitMedIntent_Ignore() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 6,
            'Account_Intent__c' => 'Medium'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
    }

    @isTest
    static void testMatrix_BelowThreshold_Ignore() {
        Account a = buildAccount(new Map<String, Object>{
            'Fit_Score_Total__c' => 3,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
    }

    @isTest
    static void testMatrix_NullFitScore_Ignore() {
        Account a = buildAccount(new Map<String, Object>{
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Ignore', eval.action);
    }

    // ─── DNN override tests ──────────────────────────────────────────────────────

    @isTest
    static void testDNN_BelowThreshold_Tier2() {
        Account a = buildAccount(new Map<String, Object>{
            'Marketplace_Prospect__c' => true,
            'Fit_Score_Total__c' => 3,
            'Account_Intent__c' => 'Low'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
        System.assert(eval.reason.contains('DNN'), 'Should mention DNN');
    }

    @isTest
    static void testDNN_MidFitLowIntent_Tier2() {
        Account a = buildAccount(new Map<String, Object>{
            'Marketplace_Prospect__c' => true,
            'Fit_Score_Total__c' => 9,
            'Account_Intent__c' => 'Low'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
    }

    @isTest
    static void testDNN_UpgradeTier3ToTier2() {
        Account a = buildAccount(new Map<String, Object>{
            'Marketplace_Prospect__c' => true,
            'Fit_Score_Total__c' => 7,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 2', eval.recommendedTier);
        System.assert(eval.reason.contains('Upgraded to Tier 2'), 'Should mention upgrade');
    }

    @isTest
    static void testDNN_HighFitHighIntent_StaysTier1() {
        Account a = buildAccount(new Map<String, Object>{
            'Marketplace_Prospect__c' => true,
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action);
        System.assertEquals('Tier 1', eval.recommendedTier);
    }

    // ─── Action determination tests ──────────────────────────────────────────────

    @isTest
    static void testAction_NoChange_SameTier() {
        Account a = buildAccount(new Map<String, Object>{
            'ABX_Tier__c' => 'Tier 1',
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('No Change', eval.action);
        System.assertEquals('Tier 1', eval.currentTier);
        System.assertEquals('Tier 1', eval.recommendedTier);
    }

    @isTest
    static void testAction_Reclassify_DifferentTier() {
        Account a = buildAccount(new Map<String, Object>{
            'ABX_Tier__c' => 'Tier 3',
            'Fit_Score_Total__c' => 12,
            'Account_Intent__c' => 'High'
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Reclassify', eval.action);
        System.assertEquals('Tier 3', eval.currentTier);
        System.assertEquals('Tier 1', eval.recommendedTier);
    }

    @isTest
    static void testAction_Remove_HasTierBelowThreshold() {
        Account a = buildAccount(new Map<String, Object>{
            'ABX_Tier__c' => 'Tier 2',
            'Fit_Score_Total__c' => 3
        });

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Remove', eval.action);
        System.assertEquals('Tier 2', eval.currentTier);
        System.assertEquals(null, eval.recommendedTier);
    }

    // ─── Focus Account override tests ───────────────────────────────────────────

    @isTest
    static void testFocusAccount_EnterpriseAE_ForceTier1_Add() {
        // No current tier → should Add at Tier 1
        Account a = buildAccount(new Map<String, Object>{
            'Focus_Accounts__c' => true,
            'Fit_Score_Total__c' => 5,
            'Account_Intent__c' => 'Low'
        });
        // Simulate Enterprise AE role via Owner relationship
        Map<String, Object> ownerMap = new Map<String, Object>{
            'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
        };
        a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => a.Name, 'Type' => a.Type,
                'Account_Stage__c' => a.Account_Stage__c,
                'Sales_Segment__c' => a.Sales_Segment__c,
                'Company_isDefunct__c' => a.Company_isDefunct__c,
                'Consulting_IT_Filter_Flow__c' => a.Consulting_IT_Filter_Flow__c,
                'Marketplace_Prospect__c' => a.Marketplace_Prospect__c,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 5,
                'Account_Intent__c' => 'Low',
                'Owner' => ownerMap
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Add', eval.action, 'Should Add: ' + eval.reason);
        System.assertEquals('Tier 1', eval.recommendedTier, 'Should force Tier 1');
        System.assert(eval.reason.contains('Focus Account'), 'Reason should mention Focus Account');
    }

    @isTest
    static void testFocusAccount_EnterpriseAE_ForceTier1_Reclassify() {
        // Has Tier 2 → should Reclassify to Tier 1
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Reclassify Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 5,
                'Account_Intent__c' => 'Low',
                'ABX_Tier__c' => 'Tier 2',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive West' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Reclassify', eval.action, 'Should Reclassify: ' + eval.reason);
        System.assertEquals('Tier 1', eval.recommendedTier);
    }

    @isTest
    static void testFocusAccount_MidMarketAE_NoOverride() {
        // Mid-Market AE → should NOT force Tier 1, fall through to normal matrix
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'MM Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 5,
                'Account_Intent__c' => 'Low',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Mid-Market Account Executive' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        // Low fit + Low intent → should Ignore normally, not force Tier 1
        System.assertNotEquals('Tier 1', eval.recommendedTier,
            'Mid-Market AE focus account should not be forced to Tier 1');
    }

    @isTest
    static void testFocusAccount_DefunctBypassed() {
        // Defunct + Focus + Enterprise AE → defunct exclusion is bypassed, should get Tier 1
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Defunct Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'true',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 12,
                'Account_Intent__c' => 'High',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Tier 1', eval.recommendedTier, 'Defunct should be bypassed for Focus + Enterprise AE');
        System.assertEquals('Add', eval.action);
    }

    @isTest
    static void testFocusAccount_CommercialSegmentBypassed() {
        // Commercial segment + Focus + Enterprise AE → segment exclusion is bypassed
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Commercial Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Commercial',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 12,
                'Account_Intent__c' => 'High',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Tier 1', eval.recommendedTier, 'Commercial segment should be bypassed for Focus + Enterprise AE');
        System.assertEquals('Add', eval.action);
    }

    @isTest
    static void testFocusAccount_QualifiedOutStillBlocks() {
        // Qualified out + Focus + Enterprise AE → qualified out is NOT bypassed
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Qualified Out Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 12,
                'Account_Intent__c' => 'High',
                'Qualified_Out_Reason__c' => 'Too small',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertNotEquals('Tier 1', eval.recommendedTier, 'Qualified out should still block even Focus accounts');
        System.assertEquals('Ignore', eval.action);
    }

    @isTest
    static void testFocusAccount_ParentAccountBypassed() {
        // Has parent account + Focus + Enterprise AE → parent exclusion is bypassed
        Account parent = new Account(Name = 'Parent Corp');
        insert parent;
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Child Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => false,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 12,
                'Account_Intent__c' => 'High',
                'ParentId' => parent.Id,
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Tier 1', eval.recommendedTier, 'Parent account should be bypassed for Focus + Enterprise AE');
        System.assertEquals('Add', eval.action);
    }

    @isTest
    static void testFocusAccount_ConsultingFilterBypassed() {
        // Consulting/IT filter + Focus + Enterprise AE → filter exclusion is bypassed
        Account a = (Account) JSON.deserialize(
            JSON.serialize(new Map<String, Object>{
                'Name' => 'Consulting Focus', 'Type' => 'Standard',
                'Account_Stage__c' => 'Prospect',
                'Sales_Segment__c' => 'Enterprise',
                'Company_isDefunct__c' => 'false',
                'Consulting_IT_Filter_Flow__c' => true,
                'Marketplace_Prospect__c' => false,
                'Focus_Accounts__c' => true,
                'Fit_Score_Total__c' => 12,
                'Account_Intent__c' => 'High',
                'Owner' => new Map<String, Object>{
                    'UserRole' => new Map<String, Object>{ 'Name' => 'Account Executive East' }
                }
            }),
            Account.class
        );

        ABXTierService.TierEvaluation eval = ABXTierService.evaluateAccount(a);
        System.assertEquals('Tier 1', eval.recommendedTier, 'Consulting/IT filter should be bypassed for Focus + Enterprise AE');
        System.assertEquals('Add', eval.action);
    }

    // ─── Bulk processing test ────────────────────────────────────────────────────

    @isTest
    static void testProcessAccounts_Bulk() {
        List<Account> accounts = new List<Account>();
        for (Integer i = 0; i < 10; i++) {
            accounts.add(buildAccount(new Map<String, Object>{
                'Name' => 'Bulk Test ' + i,
                'Fit_Score_Total__c' => 5 + i,
                'Account_Intent__c' => 'High'
            }));
        }

        List<ABXTierService.TierEvaluation> results = ABXTierService.processAccounts(accounts);
        System.assertEquals(10, results.size());
        for (ABXTierService.TierEvaluation eval : results) {
            System.assertNotEquals(null, eval.action);
            System.assertNotEquals(null, eval.intentLevel);
        }
    }
}
