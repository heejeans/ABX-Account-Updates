#!/usr/bin/env python3
"""Generate ABX Tier Review Logic PDF."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
)

OUTPUT = "/Users/joy.son/Documents/ABX-Account-Updates/ABX_Tier_Review_Logic.pdf"

def build():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=letter,
        leftMargin=0.75*inch, rightMargin=0.75*inch,
        topMargin=0.75*inch, bottomMargin=0.75*inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title2', parent=styles['Title'], fontSize=20, spaceAfter=6, textColor=HexColor('#1a1a2e'))
    h1 = ParagraphStyle('H1', parent=styles['Heading1'], fontSize=14, spaceBefore=18, spaceAfter=6, textColor=HexColor('#1a1a2e'))
    h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontSize=12, spaceBefore=14, spaceAfter=4, textColor=HexColor('#333'))
    body = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10, leading=14, spaceAfter=4)
    bullet = ParagraphStyle('Bullet', parent=body, leftIndent=18, bulletIndent=6, spaceBefore=2, spaceAfter=2)
    cell_style = ParagraphStyle('Cell', parent=body, fontSize=9, leading=12, spaceAfter=0)
    header_cell = ParagraphStyle('HeaderCell', parent=cell_style, fontName='Helvetica-Bold', textColor=HexColor('#ffffff'))

    GRAY_BG = HexColor('#f5f5f5')
    HEADER_BG = HexColor('#1a1a2e')
    BORDER = HexColor('#cccccc')
    GREEN = HexColor('#27ae60')
    ORANGE = HexColor('#f39c12')
    RED = HexColor('#e74c3c')
    LIGHT_GREEN = HexColor('#eafaf1')
    LIGHT_ORANGE = HexColor('#fef9e7')
    LIGHT_RED = HexColor('#fdedec')
    LIGHT_GRAY = HexColor('#f9f9f9')

    story = []

    # Title
    story.append(Paragraph("ABX Tier Review", title_style))
    story.append(Paragraph("Account Evaluation Logic", ParagraphStyle('Sub', parent=body, fontSize=13, textColor=HexColor('#666'), spaceAfter=16)))
    story.append(Spacer(1, 4))

    # --- Which Accounts Are Pulled In ---
    story.append(Paragraph("Which Accounts Are Pulled In", h1))
    story.append(Paragraph("The app evaluates accounts that meet <b>any</b> of the following:", body))
    for b in [
        "Currently in ABX (have an ABX Tier)",
        "Stage is Closed Lost",
        "Marked as a Focus Account",
        "Stage is Prospect AND (Fit Score >= 5 with intent, OR is a DNN/Marketplace Prospect)",
    ]:
        story.append(Paragraph(b, bullet, bulletText='\u2022'))
    story.append(Spacer(1, 6))

    # --- Step 1: Focus Account Override ---
    story.append(Paragraph("Step 1: Focus Account Override", h1))
    story.append(Paragraph(
        "If <b>Focus Account = true</b> AND owner role is an Enterprise AE "
        "(not Mid-Market or Commercial AE):", body))
    for b in [
        "Account is <b>forced to Tier 1</b>, regardless of fit score or intent",
        "Bypasses these exclusions: defunct, sales segment, parent account, consulting/IT filter, government/education filter",
        "Still blocked by: qualified out, excluded stages, non-Standard account type",
    ]:
        story.append(Paragraph(b, bullet, bulletText='\u2022'))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Focus accounts owned by Mid-Market or Commercial AEs fall through to normal evaluation.", body))

    # --- Step 2: Exclusion Rules ---
    story.append(Paragraph("Step 2: Exclusion Rules", h1))
    story.append(Paragraph(
        "Any non-focus account that hits one of these is <b>excluded from tiering entirely</b>. "
        "If it currently has a tier, it is flagged as <b>Remove</b>. Otherwise it is <b>Ignored</b>.", body))
    story.append(Spacer(1, 4))

    excl_data = [
        [Paragraph("Exclusion", header_cell), Paragraph("Detail", header_cell)],
        [Paragraph("Has a parent account", cell_style), Paragraph("Child accounts are excluded", cell_style)],
        [Paragraph("Company is defunct", cell_style), Paragraph("Company_isDefunct = true", cell_style)],
        [Paragraph("Qualified out", cell_style), Paragraph("Any of: Qualified Out Detail, Date, or Reason is populated", cell_style)],
        [Paragraph("Consulting/IT filter", cell_style), Paragraph("Consulting_IT_Filter_Flow = true", cell_style)],
        [Paragraph("Excluded stage", cell_style), Paragraph("Customer, Pipeline, Churned Customer, Competitor, Parent is Customer, Parent in Pipeline", cell_style)],
        [Paragraph("Sales segment", cell_style), Paragraph("Commercial or Mid-Market", cell_style)],
        [Paragraph("Account type", cell_style), Paragraph("Must be Standard", cell_style)],
        [Paragraph("Government/Education", cell_style), Paragraph("Government_Education__c = true", cell_style)],
    ]
    t = Table(excl_data, colWidths=[2*inch, 4.5*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('BACKGROUND', (0, 1), (-1, -1), HexColor('#ffffff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether([t]))

    # --- Step 3: Closed Lost ---
    story.append(Paragraph("Step 3: Closed Lost Routing", h1))
    cl_data = [
        [Paragraph("Scenario", header_cell), Paragraph("Closed Lost Date", header_cell), Paragraph("Result", header_cell)],
        [Paragraph("Has a tier + closed lost within past 6 months", cell_style), Paragraph("Recent", cell_style), Paragraph("<b>Remove</b>", cell_style)],
        [Paragraph("No tier + closed lost within past 6 months", cell_style), Paragraph("Recent", cell_style), Paragraph("<b>Ignore</b> (too recent to re-target)", cell_style)],
        [Paragraph("Closed lost more than 6 months ago", cell_style), Paragraph("Older", cell_style), Paragraph("Falls through to tiering matrix (eligible for re-targeting)", cell_style)],
    ]
    t2 = Table(cl_data, colWidths=[2.5*inch, 1.3*inch, 2.7*inch])
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether([t2]))

    # --- Step 4: Tiering Matrix ---
    story.append(Paragraph("Step 4: Tiering Matrix", h1))
    story.append(Paragraph(
        "Accounts that pass exclusions and closed lost routing are scored using <b>Fit Score x Intent</b>:", body))
    story.append(Spacer(1, 4))

    matrix_data = [
        [Paragraph("Fit Score", header_cell), Paragraph("High Intent", header_cell), Paragraph("Medium Intent", header_cell), Paragraph("Low Intent", header_cell)],
        [Paragraph("<b>12 (+ Focus Accounts)</b>", cell_style), Paragraph("Tier 1", cell_style), Paragraph("Tier 2", cell_style), Paragraph("Tier 3", cell_style)],
        [Paragraph("<b>9 - 11</b>", cell_style), Paragraph("Tier 2", cell_style), Paragraph("Tier 3", cell_style), Paragraph("Ignore", cell_style)],
        [Paragraph("<b>5 - 8</b>", cell_style), Paragraph("Tier 3", cell_style), Paragraph("Ignore", cell_style), Paragraph("Ignore", cell_style)],
        [Paragraph("<b>&lt; 5</b>", cell_style), Paragraph("Ignore", cell_style), Paragraph("Ignore", cell_style), Paragraph("Ignore", cell_style)],
    ]
    t3 = Table(matrix_data, colWidths=[1.8*inch, 1.6*inch, 1.6*inch, 1.5*inch])
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        # Row 1: Tier 1 green, Tier 2 orange, Tier 3 light orange
        ('BACKGROUND', (1, 1), (1, 1), LIGHT_GREEN),
        ('BACKGROUND', (2, 1), (2, 1), LIGHT_ORANGE),
        ('BACKGROUND', (3, 1), (3, 1), LIGHT_ORANGE),
        # Row 2
        ('BACKGROUND', (1, 2), (1, 2), LIGHT_ORANGE),
        ('BACKGROUND', (2, 2), (2, 2), LIGHT_ORANGE),
        ('BACKGROUND', (3, 2), (3, 2), LIGHT_RED),
        # Row 3
        ('BACKGROUND', (1, 3), (1, 3), LIGHT_ORANGE),
        ('BACKGROUND', (2, 3), (2, 3), LIGHT_RED),
        ('BACKGROUND', (3, 3), (3, 3), LIGHT_RED),
        # Row 4
        ('BACKGROUND', (1, 4), (1, 4), LIGHT_RED),
        ('BACKGROUND', (2, 4), (2, 4), LIGHT_RED),
        ('BACKGROUND', (3, 4), (3, 4), LIGHT_RED),
        # Left column bg
        ('BACKGROUND', (0, 1), (0, -1), LIGHT_GRAY),
    ]))
    story.append(KeepTogether([t3]))
    story.append(Spacer(1, 6))

    story.append(Paragraph("<b>Intent classification:</b>", body))
    for b in [
        '<b>High</b> = contains "high" or "very high"',
        '<b>Medium</b> = contains "medium" or "moderate", or any non-empty/non-None value without a level keyword',
        '<b>Low</b> = null, empty, "None", or contains "low"',
    ]:
        story.append(Paragraph(b, bullet, bulletText='\u2022'))

    # --- Step 5: DNN Override ---
    story.append(Paragraph("Step 5: DNN/Marketplace Prospect Override", h1))
    story.append(Paragraph(
        "If an account is a DNN (Marketplace Prospect = true), it gets a <b>minimum floor of Tier 2</b>:", body))
    for b in [
        "Any matrix result of Tier 3 or Ignore is upgraded to Tier 2",
        "Applies even when fit score is below 5",
    ]:
        story.append(Paragraph(b, bullet, bulletText='\u2022'))

    # --- Appendix: Fit Score ---
    story.append(Paragraph("Appendix A: Fit Score Definition", h1))
    story.append(Paragraph(
        "<b>Fit Score Total</b> (0\u201312) is a formula field that sums four sub-components. "
        "Each component scores how well an account matches CloudZero\u2019s ideal customer profile:", body))
    story.append(Spacer(1, 4))

    fit_data = [
        [Paragraph("Component", header_cell), Paragraph("Field", header_cell), Paragraph("Range", header_cell), Paragraph("What It Measures", header_cell)],
        [Paragraph("Vertical Fit", cell_style), Paragraph("Vertical_Fit_Score_Flow__c", cell_style), Paragraph("0 \u2013 3", cell_style), Paragraph("Industry/vertical alignment with ICP", cell_style)],
        [Paragraph("Eng vs IT Led", cell_style), Paragraph("Eng_vs_IT_Led_Fit_Score_Flow__c", cell_style), Paragraph("0 \u2013 3", cell_style), Paragraph("Whether the org is engineering-led vs IT-led", cell_style)],
        [Paragraph("1st Gen / DNN", cell_style), Paragraph("X1st_Gen_or_DNN_Fit_Score__c", cell_style), Paragraph("0, 1, or 3", cell_style), Paragraph("First-generation cloud or DNN/Marketplace Prospect status", cell_style)],
        [Paragraph("AI Signal", cell_style), Paragraph("AI_Signal_Fit_Score__c", cell_style), Paragraph("0 \u2013 3", cell_style), Paragraph("Strength of AI/ML adoption signal (from AI ICP Signal)", cell_style)],
    ]
    t_fit = Table(fit_data, colWidths=[1.2*inch, 2.2*inch, 0.7*inch, 2.4*inch])
    t_fit.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether([t_fit]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "The <b>Account Fit</b> picklist (High / Medium / Low) is a separate formula used in reporting. "
        "The tiering matrix uses <b>Fit Score Total</b> (the numeric sum) directly, not this picklist.", body))
    story.append(Spacer(1, 2))
    fit_picklist_data = [
        [Paragraph("Account Fit", header_cell), Paragraph("Condition", header_cell)],
        [Paragraph("Low (forced)", cell_style), Paragraph("Consulting/IT Filter = true (regardless of score)", cell_style)],
        [Paragraph("Low", cell_style), Paragraph("Fit Score Total \u2264 4", cell_style)],
        [Paragraph("Medium", cell_style), Paragraph("Fit Score Total 5 \u2013 8", cell_style)],
        [Paragraph("High", cell_style), Paragraph("Fit Score Total 9 \u2013 12", cell_style)],
    ]
    t_fit_pl = Table(fit_picklist_data, colWidths=[1.2*inch, 5.3*inch])
    t_fit_pl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t_fit_pl)

    # --- Appendix: Intent ---
    story.append(Paragraph("Appendix B: Intent Definition", h1))
    story.append(Paragraph(
        "<b>Account Intent</b> is a picklist on the Account object derived from the <b>6sense Buying Stage</b> "
        "(accountBuyingStage6sense). A formula field maps the buying stage to an intent level:", body))
    story.append(Spacer(1, 4))

    intent_data = [
        [Paragraph("6sense Buying Stage", header_cell), Paragraph("Account Intent", header_cell), Paragraph("Tiering Classification", header_cell)],
        [Paragraph("Decision, Purchase, Consideration", cell_style), Paragraph("High", cell_style), Paragraph("<b>High</b>", cell_style)],
        [Paragraph("Awareness", cell_style), Paragraph("Medium", cell_style), Paragraph("<b>Medium</b>", cell_style)],
        [Paragraph("Target", cell_style), Paragraph("Low", cell_style), Paragraph("<b>Low</b>", cell_style)],
        [Paragraph("No data / other", cell_style), Paragraph("None", cell_style), Paragraph("<b>Low</b> (treated as Low for tiering)", cell_style)],
    ]
    t_intent = Table(intent_data, colWidths=[2.4*inch, 1.3*inch, 2.8*inch])
    t_intent.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#ffffff')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), LIGHT_GRAY]),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether([t_intent]))
    story.append(Spacer(1, 4))

    story.append(Paragraph("<b>How it works:</b>", body))
    for b in [
        '6sense syncs the account\u2019s buying stage into <b>accountBuyingStage6sense__c</b>',
        'A formula field (<b>Account_Intent_Formula__c</b>) maps the stage to High / Medium / Low / None',
        'A scheduled Flow runs daily and syncs the formula value into the <b>Account_Intent__c</b> picklist',
        'Accounts with no 6sense buying stage default to <b>None</b>, which the tiering matrix treats as Low',
    ]:
        story.append(Paragraph(b, bullet, bulletText='\u2022'))

    doc.build(story)
    print(f"PDF created: {OUTPUT}")

if __name__ == '__main__':
    build()
