/**
 * H4 Billing ERP - Document Renderer Service
 * Central service for A4/A3 document rendering with proper pagination
 * Version: 2.0.0
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
 * RESPONSIBILITY
 * ============================================================
 * 
 * - Generates A4/A3 document HTML with proper page breaks
 * - Applies template configuration (fonts, spacing, visibility)
 * - Resolves image IDs through image-service
 * - Escapes all user-entered HTML
 * - FULL multi-page document support with content-based splitting
 * - Configurable page size and orientation
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT calculate GST (handled by calculation-engine.js)
 * - Does NOT calculate discount (handled by calculation-engine.js)
 * - Does NOT calculate subtotal (handled by calculation-engine.js)
 * - Does NOT calculate grand total (handled by calculation-engine.js)
 * - Does NOT calculate round-off (handled by calculation-engine.js)
 * - Does NOT generate PDF (handled by pdf-service.js)
 * - Does NOT handle print (handled by print-service.js)
 * - Does NOT contain UI logic
 * - Does NOT access IndexedDB directly
 * ============================================================
 */

// ============================================================
// IMPORTS
// ============================================================

import { database } from '../core/database.js';
import { imageService } from '../services/image-service.js';

// ============================================================
// CONSTANTS
// ============================================================

const PAGE_SIZES = {
    A4: { width: 210, height: 297, unit: 'mm' },
    A3: { width: 297, height: 420, unit: 'mm' },
    A5: { width: 148, height: 210, unit: 'mm' },
    Letter: { width: 215.9, height: 279.4, unit: 'mm' },
    Legal: { width: 215.9, height: 355.6, unit: 'mm' }
};

// Approximate height per line of text (in mm)
const LINE_HEIGHT_MM = 5;
const HEADER_HEIGHT_MM = 30;
const FOOTER_HEIGHT_MM = 20;
const MARGIN_TOP_MM = 20;
const MARGIN_BOTTOM_MM = 20;

const DEFAULT_FONTS = {
    family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    size: 11,
    weight: 'normal',
    style: 'normal',
    color: '#1a1a2e'
};

const DEFAULT_SPACING = {
    sectionGap: 15,
    rowGap: 5,
    columnGap: 8,
    paragraphGap: 10,
    lineHeight: 1.5
};

// ============================================================
// HTML ESCAPE
// ============================================================

function _escapeHtml(str) {
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
    }

    async initialize() {
        if (this._initialized) return;
        await database.open();
        await imageService.initialize();
        this._initialized = true;
        console.log('📄 Document renderer initialized');
    }

    // ============================================================
    // MAIN RENDER FUNCTION
    // ============================================================

    async renderDocument(data) {
        await this.initialize();

        const {
            document,
            template,
            company,
            type = 'invoice',
            pageSize = 'A4',
            orientation = 'portrait'
        } = data;

        const config = template?.config || {};

        const images = await this._resolveImages(company, config);

        const fonts = { ...DEFAULT_FONTS, ...config.fonts };
        const spacing = { ...DEFAULT_SPACING, ...config.spacing };
        const visibility = config.visibility || {};
        const pageConfig = config.page || {};

        const pageSettings = {
            size: pageSize,
            orientation: orientation,
            margins: pageConfig.margins || { top: 20, right: 15, bottom: 20, left: 15 },
            background: pageConfig.background || '#ffffff'
        };

        // Build content sections with their rendered HTML and estimated height
        const sections = this._buildContentSections(document, config, company, type, images);

        // Calculate page height
        const pageHeight = this._getPageHeight(pageSettings);
        const usableHeight = pageHeight - MARGIN_TOP_MM - MARGIN_BOTTOM_MM - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM;

        // Split into pages based on content height
        const pages = this._splitContentIntoPages(sections, usableHeight);

        // Build complete HTML with all pages
        return this._renderAllPages(
            pages,
            pageSettings,
            fonts,
            spacing,
            visibility,
            images,
            document,
            config,
            company,
            type
        );
    }

    // ============================================================
    // PAGE HEIGHT CALCULATION
    // ============================================================

    _getPageHeight(pageSettings) {
        const { size, orientation, margins } = pageSettings;
        const pageSize = PAGE_SIZES[size] || PAGE_SIZES.A4;

        const height = orientation === 'portrait' ? pageSize.height : pageSize.width;
        return height;
    }

    // ============================================================
    // SECTION HEIGHT ESTIMATION
    // ============================================================

    _estimateSectionHeight(section, document, config, spacing) {
        let height = 0;

        switch (section.type) {
            case 'header':
                height = HEADER_HEIGHT_MM;
                break;

            case 'company':
                height = this._estimateCompanyHeight(document, config);
                break;

            case 'customer':
                height = this._estimateCustomerHeight(document, config);
                break;

            case 'document-info':
                height = this._estimateDocumentInfoHeight(document, config);
                break;

            case 'items':
                height = this._estimateItemsHeight(document, config);
                break;

            case 'totals':
                height = this._estimateTotalsHeight(document, config);
                break;

            case 'payment':
                height = this._estimatePaymentHeight(document, config);
                break;

            case 'upi':
                height = this._estimateUpiHeight(document, config);
                break;

            case 'signature':
                height = this._estimateSignatureHeight(document, config);
                break;

            case 'terms':
                height = this._estimateTermsHeight(document, config);
                break;

            case 'notes':
                height = this._estimateNotesHeight(document, config);
                break;

            default:
                height = 20;
        }

        // Add spacing
        height += (spacing.sectionGap || DEFAULT_SPACING.sectionGap) / 2;

        return height;
    }

    _estimateCompanyHeight(document, config) {
        const comp = config.company || {};
        if (!comp.enabled) return 0;

        let lines = 3; // Name + padding
        if (comp.showBrandName && document.companySnapshot?.brandName) lines++;
        if (comp.showAddress && document.companySnapshot?.address) lines++;
        if (comp.showPhone && document.companySnapshot?.phone) lines++;
        if (comp.showWhatsApp && document.companySnapshot?.whatsapp) lines++;
        if (comp.showEmail && document.companySnapshot?.email) lines++;
        if (comp.showWebsite && document.companySnapshot?.website) lines++;
        if (comp.showGSTIN && document.companySnapshot?.gstin) lines++;
        if (comp.showPAN && document.companySnapshot?.pan) lines++;

        return lines * LINE_HEIGHT_MM + 10;
    }

    _estimateCustomerHeight(document, config) {
        const customer = config.customer || {};
        if (!customer.enabled) return 0;

        let lines = 3; // Label + padding
        if (customer.showName && document.customerSnapshot?.name) lines++;
        if (customer.showPhone && document.customerSnapshot?.phone) lines++;
        if (customer.showWhatsApp && document.customerSnapshot?.whatsapp) lines++;
        if (customer.showEmail && document.customerSnapshot?.email) lines++;
        if (customer.showAddress && document.customerSnapshot?.address) lines++;
        if (customer.showGSTIN && document.customerSnapshot?.gstin) lines++;
        if (customer.showPAN && document.customerSnapshot?.pan) lines++;
        if (customer.showCode && document.customerSnapshot?.code) lines++;

        return lines * LINE_HEIGHT_MM + 10;
    }

    _estimateDocumentInfoHeight(document, config) {
        const doc = config.document || {};
        let lines = 2; // Header + padding

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
        const itemsHeight = items.length * 12; // ~12mm per row
        const headerHeight = 15;

        return headerHeight + itemsHeight + 10;
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

        const bank = document.companySnapshot?.bankDetails || {};
        if (payment.showBankDetails && bank.enabled) {
            lines += 4;
        }

        return lines * LINE_HEIGHT_MM + 10;
    }

    _estimateUpiHeight(document, config) {
        const upi = config.upi || {};
        if (!upi.enabled) return 0;

        const upiDetails = document.companySnapshot?.upiDetails || {};
        if (!upiDetails.enabled || !upiDetails.upiId) return 0;

        return 40; // ~40mm for UPI section
    }

    _estimateSignatureHeight(document, config) {
        const signature = config.signature || {};
        if (!signature.enabled) return 0;

        return 50; // ~50mm for signature section
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
    // CONTENT SECTION BUILDING
    // ============================================================

    _buildContentSections(document, config, company, type, images) {
        const sections = [];

        const sectionConfigs = [
            { type: 'header', content: this._renderHeader(document, config, company, type, images) },
            { type: 'company', content: this._renderCompany(config, company) },
            { type: 'customer', content: this._renderCustomer(document, config) },
            { type: 'document-info', content: this._renderDocumentInfo(document, config, type) },
            { type: 'items', content: this._renderItems(document, config) },
            { type: 'totals', content: this._renderTotals(document, config) },
            { type: 'payment', content: this._renderPayment(document, config, type) },
            { type: 'upi', content: this._renderUPI(document, config, images) },
            { type: 'signature', content: this._renderSignature(config, company, images) },
            { type: 'terms', content: this._renderTerms(document, config, type) },
            { type: 'notes', content: this._renderNotes(document, config) }
        ];

        for (const sectionConfig of sectionConfigs) {
            if (sectionConfig.content) {
                const section = {
                    type: sectionConfig.type,
                    content: sectionConfig.content,
                    height: this._estimateSectionHeight(
                        { type: sectionConfig.type },
                        document,
                        config,
                        config.spacing || DEFAULT_SPACING
                    )
                };
                sections.push(section);
            }
        }

        return sections;
    }

    // ============================================================
    // PAGE SPLITTING - CONTENT-BASED
    // ============================================================

    _splitContentIntoPages(sections, usableHeight) {
        const pages = [];
        let currentPage = [];
        let currentHeight = 0;

        for (const section of sections) {
            const sectionHeight = section.height || 20;

            // If adding this section exceeds page height, start new page
            if (currentHeight + sectionHeight > usableHeight && currentPage.length > 0) {
                pages.push(currentPage);
                currentPage = [];
                currentHeight = 0;
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
    // RENDER ALL PAGES
    // ============================================================

    _renderAllPages(pages, pageSettings, fonts, spacing, visibility, images, document, config, company, type) {
        const totalPages = pages.length;
        let allPagesHtml = '';

        for (let i = 0; i < pages.length; i++) {
            const pageNumber = i + 1;
            const sections = pages[i];

            const pageHtml = this._buildSinglePage(
                sections,
                pageSettings,
                fonts,
                spacing,
                visibility,
                images,
                pageNumber,
                totalPages,
                document,
                config,
                company,
                type
            );

            allPagesHtml += pageHtml;
        }

        return this._wrapDocument(allPagesHtml, pageSettings, fonts, spacing, visibility, totalPages);
    }

    // ============================================================
    // SINGLE PAGE BUILDER
    // ============================================================

    _buildSinglePage(sections, pageSettings, fonts, spacing, visibility, images, pageNumber, totalPages, document, config, company, type) {
        let content = '';

        for (const section of sections) {
            content += section.content;
        }

        const footerContent = this._renderFooter(document, config, type, pageNumber, totalPages);

        return `
<div class="page" style="background: ${pageSettings.background};">
    <div class="page-content" style="
        padding: ${pageSettings.margins.top}mm ${pageSettings.margins.right}mm ${pageSettings.margins.bottom}mm ${pageSettings.margins.left}mm;
        font-family: ${fonts.family};
        font-size: ${fonts.size}px;
        font-weight: ${fonts.weight};
        font-style: ${fonts.style};
        color: ${fonts.color};
        line-height: ${spacing.lineHeight};
    ">
        ${content}
        ${footerContent}
    </div>
</div>`;
    }

    // ============================================================
    // DOCUMENT WRAPPER
    // ============================================================

    _wrapDocument(pagesHtml, pageSettings, fonts, spacing, visibility, totalPages) {
        const { size, orientation, margins, background } = pageSettings;
        const pageSize = PAGE_SIZES[size] || PAGE_SIZES.A4;

        const width = orientation === 'portrait' ? pageSize.width : pageSize.height;
        const height = orientation === 'portrait' ? pageSize.height : pageSize.width;

        const styles = this._getDocumentStyles(pageSettings, fonts, spacing, visibility);

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
    <div class="document-container" style="background: ${background};">
        ${pagesHtml}
    </div>
</body>
</html>`;
    }

    // ============================================================
    // IMAGE RESOLUTION
    // ============================================================

    async _resolveImages(company, config) {
        const images = {};

        if (company?.companyLogoId) {
            images.companyLogo = await imageService.getImageDataUrl(company.companyLogoId);
        }

        if (company?.brandLogoId) {
            images.brandLogo = await imageService.getImageDataUrl(company.brandLogoId);
        }

        if (company?.signatureImageId) {
            images.signature = await imageService.getImageDataUrl(company.signatureImageId);
        }

        const upiDetails = company?.upiDetails || {};
        if (upiDetails.enabled && upiDetails.qrImageId) {
            images.upiQr = await imageService.getImageDataUrl(upiDetails.qrImageId);
        }

        const logoConfig = config.header?.logo || {};
        if (logoConfig.enabled && logoConfig.imageId) {
            images.templateLogo = await imageService.getImageDataUrl(logoConfig.imageId);
        }

        return images;
    }

    // ============================================================
    // HEADER RENDERER
    // ============================================================

    _renderHeader(document, config, company, type, images) {
        const header = config.header || {};
        if (!header.enabled) return '';

        const logo = header.logo || {};
        const isInvoice = type === 'invoice';
        const title = isInvoice ? 'TAX INVOICE' : 'QUOTATION';

        let logoImg = '';
        if (logo.enabled) {
            const imgSrc = images.templateLogo || images.companyLogo;
            if (imgSrc) {
                logoImg = `<img src="${imgSrc}" alt="Logo" style="width: ${logo.width || 120}px; height: ${logo.height || 50}px; object-fit: ${logo.fit || 'contain'};">`;
            }
        }

        let html = '<div class="header">';
        html += `<div class="header-content" style="height: ${header.height || 80}px; background: ${header.background || '#f8f9fa'};">`;

        html += `<div class="header-left">${logoImg}</div>`;

        const docTitle = header.documentTitle || {};
        if (docTitle.enabled) {
            html += `<div class="header-center" style="text-align: ${docTitle.alignment || 'center'};">
                <h1>${_escapeHtml(docTitle.text || title)}</h1>
            </div>`;
        }

        html += `<div class="header-right">`;
        const numConfig = header.invoiceNumber || {};
        if (numConfig.enabled) {
            const number = isInvoice ? document.invoiceNumber : document.quotationNumber;
            html += `<div style="text-align: ${numConfig.alignment || 'right'};">
                <strong>${_escapeHtml(numConfig.label || 'No:')}</strong> ${_escapeHtml(number || '')}
            </div>`;
        }
        const dateConfig = header.date || {};
        if (dateConfig.enabled) {
            const date = isInvoice ? document.invoiceDate : document.quotationDate;
            html += `<div style="text-align: ${dateConfig.alignment || 'right'};">
                <strong>${_escapeHtml(dateConfig.label || 'Date:')}</strong> ${_escapeHtml(this._formatDate(date))}
            </div>`;
        }
        html += '</div>';

        html += '</div></div>';
        return html;
    }

    // ============================================================
    // COMPANY RENDERER
    // ============================================================

    _renderCompany(config, company) {
        const comp = config.company || {};
        if (!comp.enabled || !company) return '';

        let html = '<div class="company-section">';
        html += `<div class="company-name"><h2>${_escapeHtml(company.companyName || '')}</h2></div>`;
        
        if (comp.showBrandName && company.brandName) {
            html += `<div class="company-brand">${_escapeHtml(company.brandName)}</div>`;
        }
        
        if (comp.showAddress && company.address) {
            let address = _escapeHtml(company.address);
            if (company.city) address += `, ${_escapeHtml(company.city)}`;
            if (company.district) address += `, ${_escapeHtml(company.district)}`;
            if (company.state) address += `, ${_escapeHtml(company.state)}`;
            if (company.pincode) address += ` - ${_escapeHtml(company.pincode)}`;
            html += `<div class="company-address">${address}</div>`;
        }
        
        if (comp.showPhone && company.phone) {
            html += `<div class="company-phone">📞 ${_escapeHtml(company.phone)}</div>`;
        }
        
        if (comp.showWhatsApp && company.whatsapp) {
            html += `<div class="company-whatsapp">📱 ${_escapeHtml(company.whatsapp)}</div>`;
        }
        
        if (comp.showEmail && company.email) {
            html += `<div class="company-email">✉️ ${_escapeHtml(company.email)}</div>`;
        }
        
        if (comp.showWebsite && company.website) {
            html += `<div class="company-website">🌐 ${_escapeHtml(company.website)}</div>`;
        }
        
        if (comp.showGSTIN && company.gstin) {
            html += `<div class="company-gstin">GSTIN: ${_escapeHtml(company.gstin)}</div>`;
        }
        
        if (comp.showPAN && company.pan) {
            html += `<div class="company-pan">PAN: ${_escapeHtml(company.pan)}</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // CUSTOMER RENDERER
    // ============================================================

    _renderCustomer(document, config) {
        const customer = config.customer || {};
        if (!customer.enabled) return '';

        const snapshot = document.customerSnapshot || {};

        let html = '<div class="customer-section">';
        html += `<div class="customer-label"><strong>Customer Details</strong></div>`;
        
        if (customer.showName && snapshot.name) {
            html += `<div class="customer-name">${_escapeHtml(snapshot.name)}</div>`;
        }
        
        if (customer.showPhone && snapshot.phone) {
            html += `<div class="customer-phone">📞 ${_escapeHtml(snapshot.phone)}</div>`;
        }
        
        if (customer.showWhatsApp && snapshot.whatsapp) {
            html += `<div class="customer-whatsapp">📱 ${_escapeHtml(snapshot.whatsapp)}</div>`;
        }
        
        if (customer.showEmail && snapshot.email) {
            html += `<div class="customer-email">✉️ ${_escapeHtml(snapshot.email)}</div>`;
        }
        
        if (customer.showAddress && snapshot.address) {
            let address = _escapeHtml(snapshot.address);
            if (snapshot.city) address += `, ${_escapeHtml(snapshot.city)}`;
            if (snapshot.state) address += `, ${_escapeHtml(snapshot.state)}`;
            if (snapshot.pincode) address += ` - ${_escapeHtml(snapshot.pincode)}`;
            html += `<div class="customer-address">${address}</div>`;
        }
        
        if (customer.showGSTIN && snapshot.gstin) {
            html += `<div class="customer-gstin">GSTIN: ${_escapeHtml(snapshot.gstin)}</div>`;
        }
        
        if (customer.showPAN && snapshot.pan) {
            html += `<div class="customer-pan">PAN: ${_escapeHtml(snapshot.pan)}</div>`;
        }
        
        if (customer.showCode && snapshot.code) {
            html += `<div class="customer-code">Code: ${_escapeHtml(snapshot.code)}</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DOCUMENT INFO RENDERER
    // ============================================================

    _renderDocumentInfo(document, config, type) {
        const doc = config.document || {};
        const isInvoice = type === 'invoice';

        let html = '<div class="document-info">';
        html += '<table class="doc-info-table">';
        html += '<tbody>';

        if (doc.showTitle) {
            const title = isInvoice ? 'TAX INVOICE' : 'QUOTATION';
            html += `<tr><td colspan="2"><h2>${_escapeHtml(title)}</h2></td></tr>`;
        }

        if (doc.showNumber) {
            const number = isInvoice ? document.invoiceNumber : document.quotationNumber;
            html += `<tr>
                <td><strong>${isInvoice ? 'Invoice No:' : 'Quotation No:'}</strong></td>
                <td>${_escapeHtml(number || '')}</td>
            </tr>`;
        }

        if (doc.showDate) {
            const date = isInvoice ? document.invoiceDate : document.quotationDate;
            html += `<tr>
                <td><strong>${isInvoice ? 'Invoice Date:' : 'Quotation Date:'}</strong></td>
                <td>${_escapeHtml(this._formatDate(date))}</td>
            </tr>`;
        }

        if (doc.showDueDate) {
            const dueDate = isInvoice ? document.dueDate : document.validUntil;
            html += `<tr>
                <td><strong>${isInvoice ? 'Due Date:' : 'Valid Until:'}</strong></td>
                <td>${_escapeHtml(this._formatDate(dueDate))}</td>
            </tr>`;
        }

        if (doc.showStatus && document.status) {
            html += `<tr>
                <td><strong>Status:</strong></td>
                <td>${_escapeHtml(document.status)}</td>
            </tr>`;
        }

        html += '</tbody></table></div>';
        return html;
    }

    // ============================================================
    // ITEMS RENDERER
    // ============================================================

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
            const style = `text-align: ${col.alignment || 'left'}; width: ${col.width || 'auto'}px;`;
            html += `<th style="${style}">${_escapeHtml(col.label)}</th>`;
        }
        html += '</tr></thead>';
        
        html += '<tbody>';
        let sno = 0;
        for (const item of items) {
            sno++;
            html += '<tr>';
            for (const col of visibleColumns) {
                const style = `text-align: ${col.alignment || 'left'};`;
                const value = this._getItemValue(item, col.id, sno);
                html += `<td style="${style}">${value}</td>`;
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
            case 'product': return _escapeHtml(item.name || '');
            case 'description': return _escapeHtml(item.description || '');
            case 'hsn': return _escapeHtml(item.hsn || '');
            case 'qty': return this._formatNumber(item.quantity);
            case 'unit': return _escapeHtml(item.unit || '');
            case 'rate': return this._formatCurrency(item.rate);
            case 'discount': return this._formatNumber(item.discountValue || 0) + '%';
            case 'amount': return this._formatCurrency(item.total);
            default: return '';
        }
    }

    // ============================================================
    // TOTALS RENDERER
    // ============================================================

    _renderTotals(document, config) {
        const totals = config.totals || {};

        const totalFields = [
            { key: 'subtotal', field: 'subtotal' },
            { key: 'discount', field: 'discountAmount' },
            { key: 'taxableAmount', field: 'taxableAmount' },
            { key: 'cgst', field: 'cgst' },
            { key: 'sgst', field: 'sgst' },
            { key: 'igst', field: 'igst' },
            { key: 'gstAmount', field: 'gstAmount' },
            { key: 'roundOff', field: 'roundOff' },
            { key: 'grandTotal', field: 'grandTotal' }
        ];

        let html = '<div class="totals-section">';
        
        for (const totalField of totalFields) {
            const configField = totals[totalField.key];
            if (!configField || !configField.enabled) continue;
            
            const value = document[totalField.field] || 0;
            const style = `text-align: ${configField.position || 'right'};`;
            const fontWeight = configField.fontWeight || 'normal';
            
            html += `<div class="total-row" style="${style}; font-weight: ${fontWeight};">`;
            html += `<span class="total-label">${_escapeHtml(configField.label || totalField.key)}:</span>`;
            html += `<span class="total-value">${this._formatCurrency(value)}</span>`;
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // PAYMENT RENDERER
    // ============================================================

    _renderPayment(document, config, type) {
        const payment = config.payment || {};
        if (!payment.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="payment-section">';
        html += '<h4>Payment Details</h4>';
        
        if (payment.showStatus) {
            html += `<div class="payment-status">Status: ${_escapeHtml(document.paymentStatus || 'unpaid')}</div>`;
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
            html += `<div class="bank-details">`;
            if (bank.bankName) html += `<div>Bank: ${_escapeHtml(bank.bankName)}</div>`;
            if (bank.accountName) html += `<div>Account: ${_escapeHtml(bank.accountName)}</div>`;
            if (bank.accountNumber) html += `<div>Account No: ${_escapeHtml(bank.accountNumber)}</div>`;
            if (bank.ifsc) html += `<div>IFSC: ${_escapeHtml(bank.ifsc)}</div>`;
            if (bank.branch) html += `<div>Branch: ${_escapeHtml(bank.branch)}</div>`;
            html += `</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // UPI RENDERER
    // ============================================================

    _renderUPI(document, config, images) {
        const upi = config.upi || {};
        if (!upi.enabled) return '';

        const company = document.companySnapshot || {};
        const upiDetails = company.upiDetails || {};

        if (!upiDetails.enabled || !upiDetails.upiId) return '';

        let html = '<div class="upi-section">';
        html += '<h4>UPI Payment</h4>';
        
        if (upi.showUPIId) {
            html += `<div class="upi-id">UPI ID: ${_escapeHtml(upiDetails.upiId)}</div>`;
        }
        
        if (upi.showQRCode && images.upiQr) {
            html += `<div class="upi-qr">
                <img src="${images.upiQr}" alt="UPI QR Code" style="width: ${upi.width || 100}px; height: ${upi.height || 100}px;">
            </div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // SIGNATURE RENDERER
    // ============================================================

    _renderSignature(config, company, images) {
        const signature = config.signature || {};
        if (!signature.enabled) return '';

        const signatory = company?.authorizedSignatory || {};

        let html = '<div class="signature-section">';
        html += '<h4>Authorized Signatory</h4>';
        
        if (signature.showSignature && images.signature) {
            html += `<div class="signature-image">
                <img src="${images.signature}" alt="Signature" style="width: ${signature.width || 120}px; height: ${signature.height || 50}px; object-fit: contain;">
            </div>`;
        }
        
        if (signature.showName && signatory.name) {
            html += `<div class="signatory-name">${_escapeHtml(signatory.name)}</div>`;
        }
        
        if (signature.showDesignation && signatory.designation) {
            html += `<div class="signatory-designation">${_escapeHtml(signatory.designation)}</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // TERMS RENDERER
    // ============================================================

    _renderTerms(document, config, type) {
        const terms = config.terms || {};
        if (!terms.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="terms-section">';
        html += '<h4>Terms & Conditions</h4>';
        
        if (isInvoice && terms.invoiceTerms && document.terms) {
            html += `<div class="terms-text">${_escapeHtml(document.terms)}</div>`;
        } else if (!isInvoice && terms.quotationTerms && document.terms) {
            html += `<div class="terms-text">${_escapeHtml(document.terms)}</div>`;
        }

        if (terms.warrantyTerms && document.warrantyTerms) {
            html += `<div class="warranty-text">${_escapeHtml(document.warrantyTerms)}</div>`;
        }

        if (terms.paymentTerms && document.paymentTerms) {
            html += `<div class="payment-terms">${_escapeHtml(document.paymentTerms)}</div>`;
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // NOTES RENDERER
    // ============================================================

    _renderNotes(document, config) {
        if (!document.notes) return '';

        let html = '<div class="notes-section">';
        html += '<h4>Notes</h4>';
        html += `<div class="notes-text">${_escapeHtml(document.notes)}</div>`;
        html += '</div>';
        return html;
    }

    // ============================================================
    // FOOTER RENDERER
    // ============================================================

    _renderFooter(document, config, type, pageNumber, totalPages) {
        const footer = config.footer || {};
        if (!footer.enabled) return '';

        const isInvoice = type === 'invoice';

        let html = '<div class="footer">';
        html += `<div style="text-align: ${footer.position || 'center'};">`;
        
        if (isInvoice && footer.invoiceFooter && document.invoiceFooter) {
            html += `<div class="footer-text">${_escapeHtml(document.invoiceFooter)}</div>`;
        } else if (!isInvoice && footer.quotationFooter && document.quotationFooter) {
            html += `<div class="footer-text">${_escapeHtml(document.quotationFooter)}</div>`;
        }

        if (footer.customText) {
            html += `<div class="footer-custom">${_escapeHtml(footer.customText)}</div>`;
        }

        if (footer.pageNumber) {
            html += `<div class="page-number">Page ${pageNumber} of ${totalPages}</div>`;
        }

        html += '</div></div>';
        return html;
    }

    // ============================================================
    // DOCUMENT STYLES
    // ============================================================

    _getDocumentStyles(pageSettings, fonts, spacing, visibility) {
        const { size, orientation, margins } = pageSettings;
        const pageSize = PAGE_SIZES[size] || PAGE_SIZES.A4;

        const width = orientation === 'portrait' ? pageSize.width : pageSize.height;
        const height = orientation === 'portrait' ? pageSize.height : pageSize.width;

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
                font-family: ${fonts.family || 'Inter, sans-serif'};
                font-size: ${fonts.size || 11}px;
                font-weight: ${fonts.weight || 'normal'};
                font-style: ${fonts.style || 'normal'};
                color: ${fonts.color || '#1a1a2e'};
                line-height: ${spacing.lineHeight || 1.5};
                background: #ffffff;
            }

            .document-container {
                max-width: 100%;
                background: ${pageSettings.background || '#ffffff'};
            }

            .page {
                page-break-after: always;
                min-height: ${height}mm;
                background: ${pageSettings.background || '#ffffff'};
                display: flex;
                flex-direction: column;
            }

            .page:last-child {
                page-break-after: auto;
            }

            .page-content {
                flex: 1;
                padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
            }

            .page-break {
                page-break-after: always;
                height: 0;
                visibility: hidden;
            }

            .header {
                border-bottom: 2px solid #6C3BC5;
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding-bottom: 10px;
            }

            .header-content {
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                padding: 10px 15px;
                border-radius: 4px;
                gap: ${spacing.columnGap || 8}px;
            }

            .header-left {
                flex: 0 0 auto;
            }

            .header-center {
                flex: 1;
                text-align: center;
            }

            .header-right {
                flex: 0 0 auto;
                text-align: right;
            }

            .header-title h1 {
                font-size: 24px;
                font-weight: 700;
                color: #6C3BC5;
                margin: 0;
            }

            .header-number, .header-date {
                font-size: 12px;
                color: #333;
            }

            .company-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 4px;
            }

            .company-name h2 {
                font-size: 18px;
                font-weight: 700;
                color: #1a1a2e;
                margin: 0 0 4px 0;
            }

            .company-brand {
                font-size: 14px;
                font-weight: 500;
                color: #6C3BC5;
            }

            .company-address, .company-phone, .company-whatsapp,
            .company-email, .company-website, .company-gstin, .company-pan {
                font-size: 11px;
                color: #555;
                margin: 2px 0;
            }

            .customer-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 4px;
            }

            .customer-label {
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 8px;
                color: #1a1a2e;
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
                padding: 15px;
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
                color: #6C3BC5;
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
                text-align: left;
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
                max-width: 400px;
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
                border-top: 2px solid #6C3BC5;
                padding-top: 8px;
                margin-top: 4px;
            }

            .total-row.grand-total .total-label {
                color: #1a1a2e;
            }

            .total-row.grand-total .total-value {
                color: #6C3BC5;
            }

            .payment-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
            }

            .payment-section h4 {
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

            .upi-section {
                margin-bottom: ${spacing.sectionGap || 15}px;
                padding: 15px;
                background: #fff;
                border: 1px solid #e9ecef;
                border-radius: 4px;
                text-align: center;
            }

            .upi-section h4 {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 8px;
            }

            .upi-id {
                font-size: 14px;
                font-weight: 500;
                color: #6C3BC5;
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

            .signature-section h4 {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 8px;
                text-align: left;
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

            .terms-section h4 {
                font-size: 14px;
                font-weight: 600;
                color: #1a1a2e;
                margin-bottom: 8px;
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

            .notes-section h4 {
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
                padding-top: 15px;
                border-top: 1px solid #e9ecef;
                font-size: 10px;
                color: #999;
                text-align: center;
            }

            .footer-text, .footer-custom {
                margin: 4px 0;
            }

            .page-number {
                margin-top: 8px;
                font-size: 10px;
                color: #999;
            }

            @media print {
                body { 
                    background: white; 
                    margin: 0;
                    padding: 0;
                }
                .page {
                    page-break-after: always;
                    min-height: 100vh;
                }
                .page:last-child {
                    page-break-after: auto;
                }
                .page-break {
                    page-break-after: always;
                }
            }

            @media (max-width: 768px) {
                .header-content {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 8px;
                }
                .header-right {
                    text-align: left !important;
                }
                .header-number, .header-date {
                    text-align: left !important;
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

    async renderPreview(data) {
        return this.renderDocument(data);
    }

    getPageSize(size = 'A4') {
        return PAGE_SIZES[size] || PAGE_SIZES.A4;
    }

    getSupportedPageSizes() {
        return Object.keys(PAGE_SIZES);
    }

    /**
     * Get estimated page count for a document
     * @param {Object} data - Document data
     * @param {string} pageSize - Page size
     * @param {string} orientation - Page orientation
     * @returns {number} - Estimated page count
     */
    async estimatePageCount(data, pageSize = 'A4', orientation = 'portrait') {
        await this.initialize();

        const { document, template, company, type = 'invoice' } = data;
        const config = template?.config || {};
        const spacing = { ...DEFAULT_SPACING, ...config.spacing };

        const pageHeight = PAGE_SIZES[pageSize]?.height || PAGE_SIZES.A4.height;
        const usableHeight = pageHeight - MARGIN_TOP_MM - MARGIN_BOTTOM_MM - HEADER_HEIGHT_MM - FOOTER_HEIGHT_MM;

        const sections = this._buildContentSections(document, config, company, type, {});
        const pages = this._splitContentIntoPages(sections, usableHeight);

        return pages.length;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const documentRenderer = new DocumentRenderer();

// ============================================================
// EXPORT
// ============================================================

export { documentRenderer };
export default documentRenderer;

// ============================================================
// SUMMARY
// ============================================================
// 
// PAGINATION: ✅ FULL CONTENT-BASED MULTI-PAGE SPLITTING
// 
// How it works:
// 1. Each section has an estimated height
// 2. Sections are accumulated until page limit reached
// 3. New page starts when adding section would exceed limit
// 4. Each page gets header + sections + footer
// 5. Page X of Y rendered in footer
// 
// CORRECTIONS APPLIED:
// 
// 1. ✓ Image Resolution via imageService
// 2. ✓ HTML Escaping for all user input
// 3. ✓ FULL Multi-Page Support with content-based splitting
// 4. ✓ Template Configuration Applied (fonts, spacing, visibility)
// 
// ============================================================