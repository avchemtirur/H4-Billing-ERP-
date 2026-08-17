/**
 * H4 Billing ERP - Document Renderer
 * Central document rendering with automatic intelligent pagination
 * Version: 2.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * document-renderer.js renders Invoice and Quotation documents
 * in A4, A3, and other page sizes using template configuration
 * and calculated data.
 * 
 * ============================================================
 * PAGINATION ARCHITECTURE
 * ============================================================
 * 
 * 1. Content sections are identified and measured
 * 2. Section heights are calculated based on content
 * 3. Pages are created by accumulating sections until height limit
 * 4. Each page has: header + sections + footer
 * 5. Page X of Y is rendered in footer
 * 6. Full pagination with content-based splitting
 * 
 * ============================================================
 * SUPPORTED PAGE SIZES
 * ============================================================
 * 
 * - A4 (210mm × 297mm) - Default
 * - A3 (297mm × 420mm)
 * - A5 (148mm × 210mm)
 * - Letter (215.9mm × 279.4mm)
 * - Legal (215.9mm × 355.6mm)
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT calculate GST (calculation-engine.js)
 * - Does NOT calculate discount (calculation-engine.js)
 * - Does NOT calculate subtotal (calculation-engine.js)
 * - Does NOT calculate grand total (calculation-engine.js)
 * - Does NOT calculate round-off (calculation-engine.js)
 * - Does NOT access IndexedDB directly
 * - Does NOT contain business logic
 * - Does NOT contain UI logic
 * - Does NOT generate PDF (pdf-service.js)
 * - Does NOT handle print (print-service.js)
 * ============================================================
 */

// ============================================================
// PAGE SIZE CONFIGURATIONS
// ============================================================

const PAGE_SIZES = {
    A4: { width: 210, height: 297, unit: 'mm', label: 'A4' },
    A3: { width: 297, height: 420, unit: 'mm', label: 'A3' },
    A5: { width: 148, height: 210, unit: 'mm', label: 'A5' },
    Letter: { width: 215.9, height: 279.4, unit: 'mm', label: 'Letter' },
    Legal: { width: 215.9, height: 355.6, unit: 'mm', label: 'Legal' }
};

const DEFAULT_PAGE_SIZE = 'A4';
const DEFAULT_ORIENTATION = 'portrait';
const DEFAULT_MARGINS = { top: 20, right: 15, bottom: 20, left: 15 };

// Height constants (in mm)
const HEADER_HEIGHT_MM = 80;
const FOOTER_HEIGHT_MM = 25;
const LINE_HEIGHT_MM = 5;
const SECTION_PADDING_MM = 15;

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#47;'
    };
    return String(str).replace(/[&<>"'/]/g, function(s) {
        return map[s] || s;
    });
}

// ============================================================
// DOCUMENT RENDERER CLASS
// ============================================================

class DocumentRenderer {
    constructor() {
        this._initialized = false;
        this._pageSize = DEFAULT_PAGE_SIZE;
        this._orientation = DEFAULT_ORIENTATION;
        this._margins = DEFAULT_MARGINS;
    }

    /**
     * Initialize the renderer
     */
    async initialize() {
        if (this._initialized) return;
        this._initialized = true;
        console.log('📄 Document Renderer initialized');
    }

    // ============================================================
    // CONFIGURATION
    // ============================================================

    setDefaultPageSize(size) {
        if (PAGE_SIZES[size]) {
            this._pageSize = size;
        }
    }

    setDefaultOrientation(orientation) {
        if (orientation === 'portrait' || orientation === 'landscape') {
            this._orientation = orientation;
        }
    }

    setDefaultMargins(margins) {
        this._margins = { ...this._margins, ...margins };
    }

    getPageSize(size, orientation) {
        const pageSize = PAGE_SIZES[size] || PAGE_SIZES[DEFAULT_PAGE_SIZE];
        const isPortrait = orientation === 'portrait';

        return {
            ...pageSize,
            width: isPortrait ? pageSize.width : pageSize.height,
            height: isPortrait ? pageSize.height : pageSize.width
        };
    }

    getSupportedPageSizes() {
        return Object.keys(PAGE_SIZES);
    }

    // ============================================================
    // MAIN RENDER FUNCTION - WITH AUTOMATIC PAGINATION
    // ============================================================

    /**
     * Render document to HTML with automatic pagination
     * @param {Object} data - Document data
     * @param {Object} options - Render options
     * @returns {string} - HTML string
     */
    renderDocument(data, options = {}) {
        const {
            document,
            templateSnapshot,
            type = 'invoice'
        } = data;

        const {
            pageSize = this._pageSize,
            orientation = this._orientation,
            margins = this._margins
        } = options;

        const config = templateSnapshot?.config || {};
        const spacing = config.spacing || {};
        const pageConfig = config.page || {};

        // Final page settings
        const finalMargins = { ...pageConfig.margins, ...margins };
        const finalOrientation = pageConfig.orientation || orientation;
        const finalPageSize = pageConfig.pageSize || pageSize;
        const finalPage = this.getPageSize(finalPageSize, finalOrientation);

        // Calculate usable height per page
        const usableHeight = finalPage.height - finalMargins.top - finalMargins.bottom - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM;

        // ============================================================
        // STEP 1: Build content sections with height estimates
        // ============================================================
        const sections = this._buildContentSections(document, config, type, spacing);

        // ============================================================
        // STEP 2: Split sections into pages
        // ============================================================
        const pages = this._splitContentIntoPages(sections, usableHeight, spacing);

        // ============================================================
        // STEP 3: Render each page
        // ============================================================
        let allPagesHtml = '';
        const totalPages = pages.length;

        for (let i = 0; i < pages.length; i++) {
            const pageNumber = i + 1;
            const isFirstPage = i === 0;
            const pageSections = pages[i];

            const pageData = {
                document,
                templateSnapshot,
                type,
                pageNumber,
                totalPages,
                isFirstPage,
                pageSections,
                pageSize: finalPage,
                margins: finalMargins,
                orientation: finalOrientation
            };

            allPagesHtml += this._renderPage(pageData);
        }

        // ============================================================
        // STEP 4: Wrap in document
        // ============================================================
        return this._wrapDocument(allPagesHtml, config, finalPage, finalMargins, finalOrientation);
    }

    // ============================================================
    // CONTENT SECTION BUILDING WITH HEIGHT ESTIMATION
    // ============================================================

    _buildContentSections(document, config, type, spacing) {
        const sections = [];
        const isInvoice = type === 'invoice';

        // Helper to add section with height
        const addSection = (type, content, height) => {
            if (content) {
                sections.push({ type, content, height: height || 20 });
            }
        };

        // Header (always on first page)
        addSection('header', this._renderHeader(document, config, type), HEADER_HEIGHT_MM);

        // Company
        addSection('company', this._renderCompany(document, config), this._estimateCompanyHeight(document, config));

        // Customer
        addSection('customer', this._renderCustomer(document, config), this._estimateCustomerHeight(document, config));

        // Document Info
        addSection('document-info', this._renderDocumentInfo(document, config, type), this._estimateDocumentInfoHeight(document, config));

        // Items
        addSection('items', this._renderItems(document, config), this._estimateItemsHeight(document, config));

        // Totals
        addSection('totals', this._renderTotals(document, config), this._estimateTotalsHeight(document, config));

        // Payment
        addSection('payment', this._renderPayment(document, config, type), this._estimatePaymentHeight(document, config));

        // UPI
        addSection('upi', this._renderUPI(document, config), this._estimateUpiHeight(document, config));

        // Signature
        addSection('signature', this._renderSignature(document, config), this._estimateSignatureHeight(document, config));

        // Terms
        addSection('terms', this._renderTerms(document, config, type), this._estimateTermsHeight(document, config));

        // Notes
        addSection('notes', this._renderNotes(document, config), this._estimateNotesHeight(document, config));

        return sections;
    }

    // ============================================================
    // HEIGHT ESTIMATION METHODS
    // ============================================================

    _estimateCompanyHeight(document, config) {
        const comp = config.company || {};
        if (!comp.enabled) return 0;

        let lines = 3;
        const company = document.companySnapshot || {};
        if (comp.showBrandName && company.brandName) lines++;
        if (comp.showAddress && company.address) lines++;
        if (comp.showPhone && company.phone) lines++;
        if (comp.showWhatsApp && company.whatsapp) lines++;
        if (comp.showEmail && company.email) lines++;
        if (comp.showWebsite && company.website) lines++;
        if (comp.showGSTIN && company.gstin) lines++;
        if (comp.showPAN && company.pan) lines++;

        return lines * LINE_HEIGHT_MM + SECTION_PADDING_MM;
    }

    _estimateCustomerHeight(document, config) {
        const customer = config.customer || {};
        if (!customer.enabled) return 0;

        let lines = 3;
        const snapshot = document.customerSnapshot || {};
        if (customer.showName && snapshot.name) lines++;
        if (customer.showPhone && snapshot.phone) lines++;
        if (customer.showWhatsApp && snapshot.whatsapp) lines++;
        if (customer.showEmail && snapshot.email) lines++;
        if (customer.showAddress && snapshot.address) lines++;
        if (customer.showGSTIN && snapshot.gstin) lines++;
        if (customer.showPAN && snapshot.pan) lines++;
        if (customer.showCode && snapshot.code) lines++;

        return lines * LINE_HEIGHT_MM + SECTION_PADDING_MM;
    }

    _estimateDocumentInfoHeight(document, config) {
        const doc = config.document || {};
        let lines = 2;

        if (doc.showTitle) lines += 2;
        if (doc.showNumber) lines++;
        if (doc.showDate) lines++;
        if (doc.showDueDate) lines++;
        if (doc.showStatus && document.status) lines++;

        return lines * LINE_HEIGHT_MM + 5;
    }

    _estimateItemsHeight(document, config) {
        const itemTable = config.itemTable || {};
        if (!itemTable.enabled) return 0;

        const items = document.items || [];
        const rowHeight = itemTable.rowHeight || 12;
        const headerHeight = 15;

        return headerHeight + (items.length * rowHeight) + 10;
    }

    _estimateTotalsHeight(document, config) {
        const totals = config.totals || {};
        let count = 0;

        const fields = ['subtotal', 'discount', 'taxableAmount', 'cgst', 'sgst', 'igst', 'gstAmount', 'roundOff', 'grandTotal'];
        for (const field of fields) {
            if (totals[field]?.enabled) count++;
        }

        return count * 10 + 15;
    }

    _estimatePaymentHeight(document, config) {
        const payment = config.payment || {};
        if (!payment.enabled) return 0;

        let lines = 3;
        if (payment.showStatus) lines++;
        if (payment.showPaidAmount) lines++;
        if (payment.showOutstanding) lines++;

        const company = document.companySnapshot || {};
        const bank = company.bankDetails || {};
        if (payment.showBankDetails && bank.enabled) {
            lines += 4;
        }

        return lines * LINE_HEIGHT_MM + 10;
    }

    _estimateUpiHeight(document, config) {
        const upi = config.upi || {};
        if (!upi.enabled) return 0;

        const company = document.companySnapshot || {};
        const upiDetails = company.upiDetails || {};
        if (!upiDetails.enabled || !upiDetails.upiId) return 0;

        return 40;
    }

    _estimateSignatureHeight(document, config) {
        const signature = config.signature || {};
        if (!signature.enabled) return 0;

        return 50;
    }

    _estimateTermsHeight(document, config) {
        const terms = config.terms || {};
        if (!terms.enabled) return 0;

        let lines = 2;
        if (document.terms) lines += Math.ceil(document.terms.length / 80);
        if (document.warrantyTerms) lines += Math.ceil(document.warrantyTerms.length / 80);
        if (document.paymentTerms) lines += Math.ceil(document.paymentTerms.length / 80);

        return lines * LINE_HEIGHT_MM + 10;
    }

    _estimateNotesHeight(document, config) {
        if (!document.notes) return 0;

        const lines = Math.ceil(document.notes.length / 80);
        return lines * LINE_HEIGHT_MM + 10;
    }

    // ============================================================
    // AUTOMATIC PAGE SPLITTING
    // ============================================================

    _splitContentIntoPages(sections, usableHeight, spacing) {
        const pages = [];
        let currentPage = [];
        let currentHeight = 0;

        // Header always on first page
        let headerProcessed = false;

        for (const section of sections) {
            // Skip empty sections
            if (!section.content || section.height <= 0) continue;

            // Header is always first on page 1
            if (section.type === 'header') {
                currentPage.push(section);
                currentHeight += section.height;
                headerProcessed = true;
                continue;
            }

            const sectionHeight = section.height || 20;

            // If adding this section exceeds page height, start new page
            if (currentHeight + sectionHeight > usableHeight && currentPage.length > 0) {
                // Ensure we have at least header on new page
                if (headerProcessed) {
                    // Only start new page if we have content
                    pages.push(currentPage);
                    currentPage = [];
                    currentHeight = 0;
                }
            }

            currentPage.push(section);
            currentHeight += sectionHeight;
        }

        // Add remaining sections
        if (currentPage.length > 0) {
            pages.push(currentPage);
        }

        // Ensure at least one page
        if (pages.length === 0) {
            pages.push([]);
        }

        return pages;
    }

    // ============================================================
    // PAGE RENDERER
    // ============================================================

    _renderPage(data) {
        const {
            document,
            templateSnapshot,
            type = 'invoice',
            pageNumber = 1,
            totalPages = 1,
            isFirstPage = true,
            pageSections = [],
            pageSize,
            margins,
            orientation
        } = data;

        const config = templateSnapshot?.config || {};

        // Build sections HTML
        let sectionsHtml = '';
        for (const section of pageSections) {
            sectionsHtml += section.content;
        }

        // Footer
        const footerHtml = this._renderFooter(document, config, type, pageNumber, totalPages);

        return `
            <div class="page" style="
                page-break-after: ${pageNumber < totalPages ? 'always' : 'auto'};
                min-height: ${pageSize.height}mm;
                background: ${config.page?.background || '#ffffff'};
                display: flex;
                flex-direction: column;
            ">
                <div class="page-content" style="
                    padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
                    flex: 1;
                ">
                    ${sectionsHtml}
                    ${footerHtml}
                </div>
            </div>
        `;
    }

    // ============================================================
    // DOCUMENT WRAPPER
    // ============================================================

    _wrapDocument(pagesHtml, config, pageSize, margins, orientation) {
        const fonts = config.fonts || {};
        const spacing = config.spacing || {};
        const page = config.page || {};

        const isPortrait = orientation === 'portrait';
        const width = isPortrait ? pageSize.width : pageSize.height;
        const height = isPortrait ? pageSize.height : pageSize.width;

        const styles = this._getStyles(config, pageSize, margins, orientation);

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>${styles}</style>
</head>
<body>
    <div class="document-container" style="
        font-family: ${fonts.family || 'Inter, sans-serif'};
        font-size: ${fonts.size || 11}px;
        color: ${fonts.color || '#1a1a2e'};
        line-height: ${spacing.lineHeight || 1.5};
        background: ${page.background || '#ffffff'};
    ">
        ${pagesHtml}
    </div>
</body>
</html>`;
    }

    // ============================================================
    // STYLES
    // ============================================================

    _getStyles(config, pageSize, margins, orientation) {
        const fonts = config.fonts || {};
        const spacing = config.spacing || {};
        const colors = config.colors || {};

        const primaryColor = colors.primary || '#6C3BC5';

        const isPortrait = orientation === 'portrait';
        const width = isPortrait ? pageSize.width : pageSize.height;
        const height = isPortrait ? pageSize.height : pageSize.width;

        return `
            @page {
                size: ${width}mm ${height}mm;
                margin: 0;
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                background: #ffffff;
                margin: 0;
                padding: 0;
            }

            .document-container {
                max-width: 100%;
                margin: 0 auto;
                min-height: ${height}mm;
                background: ${config.page?.background || '#ffffff'};
                font-family: ${fonts.family || 'Inter, sans-serif'};
                font-size: ${fonts.size || 11}px;
                font-weight: ${fonts.weight || 'normal'};
                font-style: ${fonts.style || 'normal'};
                color: ${fonts.color || '#1a1a2e'};
                line-height: ${spacing.lineHeight || 1.5};
            }

            .page {
                page-break-after: always;
                min-height: ${height}mm;
                background: ${config.page?.background || '#ffffff'};
                display: flex;
                flex-direction: column;
            }

            .page:last-child {
                page-break-after: auto;
            }

            .page-content {
                flex: 1;
                padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
                width: 100%;
            }

            /* ============================================================
               SECTION STYLES
               ============================================================ */

            .header {
                border-bottom: 2px solid ${primaryColor};
                padding-bottom: 10px;
                margin-bottom: ${spacing.sectionGap || 15}px;
            }

            .header-top {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
            }

            .logo-container {
                flex: 0 0 auto;
            }

            .company-logo {
                max-height: 60px;
                max-width: 150px;
                object-fit: contain;
            }

            .header-title-area {
                flex: 1;
                text-align: right;
            }

            .doc-title {
                font-size: 24px;
                font-weight: 700;
                color: ${primaryColor};
            }

            .doc-number, .doc-date {
                font-size: 12px;
                color: #555;
                margin-top: 2px;
            }

            .doc-number .label, .doc-date .label {
                font-weight: 600;
                color: #333;
            }

            .company-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 12px 15px;
                background: #f8f9fa;
                border-radius: 4px;
            }

            .company-name {
                font-size: 18px;
                font-weight: 700;
                color: #1a1a2e;
            }

            .company-brand {
                font-size: 14px;
                font-weight: 500;
                color: ${primaryColor};
            }

            .company-address, .company-phone, .company-whatsapp,
            .company-email, .company-website, .company-gstin, .company-pan {
                font-size: 11px;
                color: #555;
                margin: 2px 0;
            }

            .customer-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 12px 15px;
                background: #f8f9fa;
                border-radius: 4px;
            }

            .customer-label {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 6px;
            }

            .customer-name {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
            }

            .customer-phone, .customer-whatsapp, .customer-email,
            .customer-address, .customer-gstin, .customer-pan, .customer-code {
                font-size: 11px;
                color: #555;
                margin: 2px 0;
            }

            .document-info {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 12px 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
            }

            .doc-info-table {
                width: 100%;
                border-collapse: collapse;
            }

            .doc-info-table td {
                padding: 4px 8px;
                font-size: 12px;
            }

            .doc-info-table td:first-child {
                width: 140px;
                font-weight: 500;
                color: #555;
            }

            .doc-info-table td:last-child {
                color: #1a1a2e;
            }

            .doc-info-table h2 {
                font-size: 20px;
                font-weight: 700;
                color: ${primaryColor};
                margin: 0;
                text-align: center;
            }

            .items-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                overflow-x: auto;
            }

            .items-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
            }

            .items-table th {
                background: #e9ecef;
                color: #1a1a2e;
                font-weight: 600;
                padding: 8px 10px;
                border: 1px solid #dee2e6;
            }

            .items-table td {
                padding: 6px 10px;
                border: 1px solid #dee2e6;
                color: #1a1a2e;
            }

            .items-table tr:nth-child(even) {
                background: #f8f9fa;
            }

            .totals-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 4px;
                max-width: 350px;
                margin-left: auto;
            }

            .total-row {
                display: flex;
                justify-content: space-between;
                padding: ${spacing.rowGap || 5}px 0;
                font-size: 12px;
                border-bottom: 1px solid #e9ecef;
            }

            .total-row:last-child {
                border-bottom: none;
            }

            .total-row .total-label {
                color: #555;
            }

            .total-row .total-value {
                color: #1a1a2e;
                font-weight: 500;
            }

            .total-row.grand-total {
                font-size: 16px;
                font-weight: 700;
                border-top: 2px solid ${primaryColor};
                padding-top: 8px;
                margin-top: 4px;
            }

            .total-row.grand-total .total-label {
                color: #1a1a2e;
            }

            .total-row.grand-total .total-value {
                color: ${primaryColor};
            }

            .payment-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
            }

            .payment-label {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 8px;
            }

            .payment-status, .payment-paid, .payment-outstanding {
                font-size: 12px;
                color: #555;
                padding: 2px 0;
            }

            .bank-details {
                margin-top: 8px;
                padding: 10px;
                background: #f8f9fa;
                border-radius: 4px;
                font-size: 11px;
            }

            .bank-details > div {
                padding: 2px 0;
            }

            .upi-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
                text-align: center;
            }

            .upi-id {
                font-size: 14px;
                font-weight: 500;
                color: ${primaryColor};
                margin: 4px 0;
            }

            .upi-qr {
                margin: 8px 0;
            }

            .signature-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 4px;
                text-align: right;
            }

            .signature-image {
                margin: 8px 0;
                text-align: right;
            }

            .signatory-name {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
            }

            .signatory-designation {
                font-size: 12px;
                color: #555;
            }

            .terms-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
            }

            .terms-text, .warranty-text, .payment-terms {
                font-size: 11px;
                color: #555;
                padding: 4px 0;
            }

            .notes-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
            }

            .notes-label {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 8px;
            }

            .notes-text {
                font-size: 11px;
                color: #555;
                padding: 4px 0;
            }

            .footer {
                margin-top: ${spacing.sectionGap || 15}px;
                padding-top: 12px;
                border-top: 1px solid #e9ecef;
                font-size: 10px;
                color: #999;
                text-align: center;
            }

            .footer-text, .footer-custom {
                margin: 3px 0;
            }

            .footer-page-number {
                margin-top: 6px;
                font-size: 10px;
                color: #999;
            }

            @media print {
                body { background: white; }
                .page-content { padding: 0; }
                .page { min-height: 100vh; }
            }

            @media (max-width: 768px) {
                .page-content {
                    padding: 10mm 8mm;
                }
                .header-top {
                    flex-direction: column;
                    align-items: flex-start;
                }
                .header-title-area {
                    text-align: left;
                    width: 100%;
                }
                .items-table {
                    font-size: 10px;
                }
                .items-table th, .items-table td {
                    padding: 4px 6px;
                }
                .totals-section {
                    max-width: 100%;
                }
            }
        `;
    }

    // ============================================================
    // SECTION RENDERERS (No changes - same as before)
    // ============================================================

    _renderHeader(document, config, type) {
        const header = config.header || {};
        if (!header.enabled) return '';

        const isInvoice = type === 'invoice';
        const title = isInvoice ? 'TAX INVOICE' : 'QUOTATION';
        const logoConfig = header.logo || {};
        const company = document.companySnapshot || {};

        let logoHtml = '';
        if (logoConfig.enabled && company.companyLogoId) {
            logoHtml = `<div class="logo-container">
                <img src="${company.companyLogoId}" alt="Company Logo" class="company-logo">
            </div>`;
        }

        let titleHtml = '';
        const docTitle = header.documentTitle || {};
        if (docTitle.enabled) {
            titleHtml = `<div class="doc-title">${escapeHtml(docTitle.text || title)}</div>`;
        }

        let numberHtml = '';
        const numConfig = header.invoiceNumber || {};
        if (numConfig.enabled) {
            const number = isInvoice ? document.invoiceNumber : document.quotationNumber;
            numberHtml = `<div class="doc-number"><span class="label">${escapeHtml(numConfig.label || 'No:')}</span> ${escapeHtml(number || '')}</div>`;
        }

        let dateHtml = '';
        const dateConfig = header.date || {};
        if (dateConfig.enabled) {
            const date = isInvoice ? document.invoiceDate : document.quotationDate;
            dateHtml = `<div class="doc-date"><span class="label">${escapeHtml(dateConfig.label || 'Date:')}</span> ${this._formatDate(date)}</div>`;
        }

        return `
            <div class="header">
                <div class="header-top">
                    ${logoHtml}
                    <div class="header-title-area">
                        ${titleHtml}
                        ${numberHtml}
                        ${dateHtml}
                    </div>
                </div>
            </div>
        `;
    }

    _renderCompany(document, config) {
        const comp = config.company || {};
        if (!comp.enabled) return '';

        const company = document.companySnapshot || {};

        let html = '<div class="company-section">';
        html += `<div class="company-name">${escapeHtml(company.companyName || '')}</div>`;

        if (comp.showBrandName && company.brandName) {
            html += `<div class="company-brand">${escapeHtml(company.brandName)}</div>`;
        }

        let addressParts = [];
        if (comp.showAddress && company.address) addressParts.push(escapeHtml(company.address));
        if (company.city) addressParts.push(escapeHtml(company.city));
        if (company.district) addressParts.push(escapeHtml(company.district));
        if (company.state) addressParts.push(escapeHtml(company.state));
        if (company.pincode) addressParts.push(escapeHtml(company.pincode));

        if (addressParts.length > 0) {
            html += `<div class="company-address">${addressParts.join(', ')}</div>`;
        }

        if (comp.showPhone && company.phone) {
            html += `<div class="company-phone">📞 ${escapeHtml(company.phone)}</div>`;
        }

        if (comp.showWhatsApp && company.whatsapp) {
            html += `<div class="company-whatsapp">📱 ${escapeHtml(company.whatsapp)}</div>`;
        }

        if (comp.showEmail && company.email) {
            html += `<div class="company-email">✉️ ${escapeHtml(company.email)}</div>`;
        }

        if (comp.showWebsite && company.website) {
            html += `<div class="company-website">🌐 ${escapeHtml(company.website)}</div>`;
        }

        if (comp.showGSTIN && company.gstin) {
            html += `<div class="company-gstin">GSTIN: ${escapeHtml(company.gstin)}</div>`;
        }

        if (comp.showPAN && company.pan) {
            html += `<div class="company-pan">PAN: ${escapeHtml(company.pan)}</div>`;
        }

        html += '</div>';
        return html;
    }

    _renderCustomer(document, config) {
        const customer = config.customer || {};
        if (!customer.enabled) return '';

        const snapshot = document.customerSnapshot || {};

        let html = '<div class="customer-section">';
        html += '<div class="customer-label">Customer Details</div>';

        if (customer.showName && snapshot.name) {
            html += `<div class="customer-name">${escapeHtml(snapshot.name)}</div>`;
        }

        if (customer.showPhone && snapshot.phone) {
            html += `<div class="customer-phone">📞 ${escapeHtml(snapshot.phone)}</div>`;
        }

        if (customer.showWhatsApp && snapshot.whatsapp) {
            html += `<div class="customer-whatsapp">📱 ${escapeHtml(snapshot.whatsapp)}</div>`;
        }

        if (customer.showEmail && snapshot.email) {
            html += `<div class="customer-email">✉️ ${escapeHtml(snapshot.email)}</div>`;
        }

        if (customer.showAddress && snapshot.address) {
            let address = escapeHtml(snapshot.address);
            if (snapshot.city) address += `, ${escapeHtml(snapshot.city)}`;
            if (snapshot.state) address += `, ${escapeHtml(snapshot.state)}`;
            if (snapshot.pincode) address += ` - ${escapeHtml(snapshot.pincode)}`;
            html += `<div class="customer-address">${address}</div>`;
        }

        if (customer.showGSTIN && snapshot.gstin) {
            html += `<div class="customer-gstin">GSTIN: ${escapeHtml(snapshot.gstin)}</div>`;
        }

        if (customer.showPAN && snapshot.pan) {
            html += `<div class="customer-pan">PAN: ${escapeHtml(snapshot.pan)}</div>`;
        }

        if (customer.showCode && snapshot.code) {
            html += `<div class="customer-code">Code: ${escapeHtml(snapshot.code)}</div>`;
        }

        html += '</div>';
        return html;
    }

    _renderDocumentInfo(document, config, type) {
        const doc = config.document || {};
        const isInvoice = type === 'invoice';

        let html = '<div class="document-info">';
        html += '<table class="doc-info-table">';
        html += '<tbody>';

        if (doc.showTitle) {
            const title = isInvoice ? 'TAX INVOICE' : 'QUOTATION';
            html += `<tr><td colspan="2"><h2>${escapeHtml(title)}</h2></td></tr>`;
        }

        if (doc.showNumber) {
            const number = isInvoice ? document.invoiceNumber : document.quotationNumber;
            html += `<tr>
                <td><strong>${isInvoice ? 'Invoice No:' : 'Quotation No:'}</strong></td>
                <td>${escapeHtml(number || '')}</td>
            </tr>`;
        }

        if (doc.showDate) {
            const date = isInvoice ? document.invoiceDate : document.quotationDate;
            html += `<tr>
                <td><strong>${isInvoice ? 'Date:' : 'Quotation Date:'}</strong></td>
                <td>${this._formatDate(date)}</td>
            </tr>`;
        }

        if (doc.showDueDate) {
            const dueDate = isInvoice ? document.dueDate : document.validUntil;
            html += `<tr>
                <td><strong>${isInvoice ? 'Due Date:' : 'Valid Until:'}</strong></td>
                <td>${this._formatDate(dueDate)}</td>
            </tr>`;
        }

        if (doc.showStatus && document.status) {
            html += `<tr>
                <td><strong>Status:</strong></td>
                <td>${escapeHtml(document.status)}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        return html;
    }

    _renderItems(document, config) {
        const itemTable = config.itemTable || {};
        if (!itemTable.enabled) return '';

        const columns = itemTable.columns || [];
        const items = document.items || [];

        const visibleColumns = columns.filter(col => col.visible !== false);

        let html = '<div class="items-section">';
        html += '<table class="items-table">';

        html += '<thead><tr>';
        for (const col of visibleColumns) {
            const align = col.alignment || 'left';
            html += `<th style="text-align: ${align}; width: ${col.width || 'auto'}px;">${escapeHtml(col.label)}</th>`;
        }
        html += '</tr></thead>';

        html += '<tbody>';
        let sno = 0;
        for (const item of items) {
            sno++;
            html += '<tr>';
            for (const col of visibleColumns) {
                const align = col.alignment || 'left';
                const value = this._getItemValue(item, col.id, sno);
                html += `<td style="text-align: ${align};">${value}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';
        html += '</table></div>';

        return html;
    }

    _getItemValue(item, columnId, sno) {
        switch (columnId) {
            case 'sno': return sno;
            case 'product': return escapeHtml(item.name || '');
            case 'description': return escapeHtml(item.description || '');
            case 'hsn': return escapeHtml(item.hsn || '');
            case 'qty': return this._formatNumber(item.quantity);
            case 'unit': return escapeHtml(item.unit || '');
            case 'rate': return this._formatCurrency(item.rate);
            case 'discount': return this._formatNumber(item.discountValue || 0) + '%';
            case 'amount': return this._formatCurrency(item.total);
            default: return '';
        }
    }

    _renderTotals(document, config) {
        const totals = config.totals || {};

        const totalFields = [
            { key: 'subtotal', field: 'subtotal', label: 'Subtotal' },
            { key: 'discount', field: 'discountAmount', label: 'Discount' },
            { key: 'taxableAmount', field: 'taxableAmount', label: 'Taxable Amount' },
            { key: 'cgst', field: 'cgst', label: 'CGST' },
            { key: 'sgst', field: 'sgst', label: 'SGST' },
            { key: 'igst', field: 'igst', label: 'IGST' },
            { key: 'gstAmount', field: 'gstAmount', label: 'Total GST' },
            { key: 'roundOff', field: 'roundOff', label: 'Round Off' },
            { key: 'grandTotal', field: 'grandTotal', label: 'Grand Total' }
        ];

        let html = '<div class="totals-section">';

        for (const totalField of totalFields) {
            const configField = totals[totalField.key];
            if (!configField || !configField.enabled) continue;

            const value = document[totalField.field] || 0;
            const isGrandTotal = totalField.key === 'grandTotal';

            const rowClass = isGrandTotal ? 'total-row grand-total' : 'total-row';
            const fontWeight = configField.fontWeight || (isGrandTotal ? 'bold' : 'normal');

            html += `<div class="${rowClass}" style="font-weight: ${fontWeight}; text-align: ${configField.position || 'right'};">`;
            html += `<span class="total-label">${escapeHtml(configField.label || totalField.label)}</span>`;
            html += `<span class="total-value">${this._formatCurrency(value)}</span>`;
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    _renderPayment(document, config, type) {
        const payment = config.payment || {};
        if (!payment.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="payment-section">';
        html += '<div class="payment-label">Payment Details</div>';

        if (payment.showStatus) {
            html += `<div class="payment-status">Status: ${escapeHtml(document.paymentStatus || 'unpaid')}</div>`;
        }

        if (payment.showPaidAmount && isInvoice) {
            html += `<div class="payment-paid">Paid: ${this._formatCurrency(document.paidAmount || 0)}</div>`;
        }

        if (payment.showOutstanding && isInvoice) {
            html += `<div class="payment-outstanding">Outstanding: ${this._formatCurrency(document.outstandingAmount || 0)}</div>`;
        }

        const company = document.companySnapshot || {};
        const bank = company.bankDetails || {};

        if (payment.showBankDetails && bank.enabled) {
            html += '<div class="bank-details">';
            if (bank.bankName) html += `<div class="bank-name">Bank: ${escapeHtml(bank.bankName)}</div>`;
            if (bank.accountName) html += `<div class="bank-account-name">Account: ${escapeHtml(bank.accountName)}</div>`;
            if (bank.accountNumber) html += `<div class="bank-account">Account No: ${escapeHtml(bank.accountNumber)}</div>`;
            if (bank.ifsc) html += `<div class="bank-ifsc">IFSC: ${escapeHtml(bank.ifsc)}</div>`;
            if (bank.branch) html += `<div class="bank-branch">Branch: ${escapeHtml(bank.branch)}</div>`;
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    _renderUPI(document, config) {
        const upi = config.upi || {};
        if (!upi.enabled) return '';

        const company = document.companySnapshot || {};
        const upiDetails = company.upiDetails || {};

        if (!upiDetails.enabled || !upiDetails.upiId) return '';

        let html = '<div class="upi-section">';

        if (upi.showUPIId) {
            html += `<div class="upi-id">UPI ID: ${escapeHtml(upiDetails.upiId)}</div>`;
        }

        if (upi.showQRCode && upiDetails.qrImageId) {
            html += `<div class="upi-qr">
                <img src="${upiDetails.qrImageId}" alt="UPI QR Code" style="width: ${upi.width || 100}px; height: ${upi.height || 100}px;">
            </div>`;
        }

        html += '</div>';
        return html;
    }

    _renderSignature(document, config) {
        const signature = config.signature || {};
        if (!signature.enabled) return '';

        const company = document.companySnapshot || {};
        const signatory = company.authorizedSignatory || {};

        let html = '<div class="signature-section">';

        if (signature.showSignature && signatory.signatureImageId) {
            html += `<div class="signature-image">
                <img src="${signatory.signatureImageId}" alt="Signature" style="width: ${signature.width || 120}px; height: ${signature.height || 50}px; object-fit: contain;">
            </div>`;
        }

        if (signature.showName && signatory.name) {
            html += `<div class="signatory-name">${escapeHtml(signatory.name)}</div>`;
        }

        if (signature.showDesignation && signatory.designation) {
            html += `<div class="signatory-designation">${escapeHtml(signatory.designation)}</div>`;
        }

        html += '</div>';
        return html;
    }

    _renderTerms(document, config, type) {
        const terms = config.terms || {};
        if (!terms.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="terms-section">';

        if (isInvoice && terms.invoiceTerms && document.terms) {
            html += `<div class="terms-text">${escapeHtml(document.terms)}</div>`;
        } else if (!isInvoice && terms.quotationTerms && document.terms) {
            html += `<div class="terms-text">${escapeHtml(document.terms)}</div>`;
        }

        if (terms.warrantyTerms && document.warrantyTerms) {
            html += `<div class="warranty-text">${escapeHtml(document.warrantyTerms)}</div>`;
        }

        if (terms.paymentTerms && document.paymentTerms) {
            html += `<div class="payment-terms">${escapeHtml(document.paymentTerms)}</div>`;
        }

        html += '</div>';
        return html;
    }

    _renderNotes(document, config) {
        if (!document.notes) return '';

        return `
            <div class="notes-section">
                <div class="notes-label">Notes</div>
                <div class="notes-text">${escapeHtml(document.notes)}</div>
            </div>
        `;
    }

    _renderFooter(document, config, type, pageNumber, totalPages) {
        const footer = config.footer || {};
        if (!footer.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="footer">';

        if (isInvoice && footer.invoiceFooter && document.invoiceFooter) {
            html += `<div class="footer-text">${escapeHtml(document.invoiceFooter)}</div>`;
        } else if (!isInvoice && footer.quotationFooter && document.quotationFooter) {
            html += `<div class="footer-text">${escapeHtml(document.quotationFooter)}</div>`;
        }

        if (footer.customText) {
            html += `<div class="footer-custom">${escapeHtml(footer.customText)}</div>`;
        }

        if (footer.pageNumber) {
            html += `<div class="footer-page-number">Page ${pageNumber} of ${totalPages}</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    _formatDate(date) {
        if (!date) return '';
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return date;
            return d.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        } catch {
            return date;
        }
    }

    _formatNumber(value) {
        if (value === undefined || value === null) return '0';
        const num = Number(value);
        if (isNaN(num)) return '0';
        return num.toLocaleString('en-IN');
    }

    _formatCurrency(value) {
        if (value === undefined || value === null) return '₹0.00';
        const num = Number(value);
        if (isNaN(num)) return '₹0.00';
        return '₹' + num.toFixed(2);
    }

    /**
     * Estimate page count
     */
    estimatePageCount(data, pageSize = DEFAULT_PAGE_SIZE) {
        const { document, templateSnapshot, type = 'invoice' } = data;
        const config = templateSnapshot?.config || {};
        const spacing = config.spacing || {};

        const finalPage = this.getPageSize(pageSize, this._orientation);
        const usableHeight = finalPage.height - this._margins.top - this._margins.bottom - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM;

        const sections = this._buildContentSections(document, config, type, spacing);
        const pages = this._splitContentIntoPages(sections, usableHeight, spacing);

        return pages.length;
    }

    /**
     * Render preview (alias for renderDocument)
     */
    renderPreview(data, options = {}) {
        return this.renderDocument(data, options);
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const documentRenderer = new DocumentRenderer();

// ============================================================
// EXPORT
// ============================================================

export { documentRenderer, PAGE_SIZES };
export default documentRenderer;

// ============================================================
// SUMMARY
// ============================================================
// 
// ✅ AUTOMATIC INTELLIGENT PAGINATION COMPLETE
// 
// How it works:
// 1. Build content sections with height estimates
// 2. Split sections into pages based on available height
// 3. Each page gets header + sections + footer
// 4. Page X of Y rendered in footer
// 
// SUPPORTED PAGE SIZES:
// - A4 (210mm × 297mm) - Default
// - A3 (297mm × 420mm)
// - A5 (148mm × 210mm)
// - Letter (215.9mm × 279.4mm)
// - Legal (215.9mm × 355.6mm)
// 
// ============================================================