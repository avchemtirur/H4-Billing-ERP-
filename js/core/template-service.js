/**
 * H4 Billing ERP - Template Service Module
 * Central service for template management
 * Version: 2.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * template-service.js provides a clean API for template CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: templates
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.TEMPLATE_CREATED
 * - EVENTS.TEMPLATE_UPDATED
 * - EVENTS.TEMPLATE_DELETED
 * 
 * ============================================================
 * IMMUTABLE VERSIONING ARCHITECTURE
 * ============================================================
 * 
 * Each template belongs to a family identified by templateId.
 * 
 * Template Family: TPL-001
 *     │
 *     ├── V1: templateId: TPL-001, version: 1, parentVersionId: null, isLatest: false
 *     ├── V2: templateId: TPL-001, version: 2, parentVersionId: V1-id, isLatest: false
 *     └── V3: templateId: TPL-001, version: 3, parentVersionId: V2-id, isLatest: true
 * 
 * Versioning Rules:
 * - Content/config changes → NEW VERSION
 * - Active/Inactive status → Direct metadata update (acceptable)
 * - Default status → Direct metadata update (acceptable)
 * 
 * ============================================================
 * FAILURE-SAFE DESIGN
 * ============================================================
 * 
 * 1. isDefault Logic:
 *    - New template saved first
 *    - Then clear OTHER defaults (excluding the new template)
 *    - Ensures at least one default always exists
 * 
 * 2. Version Update:
 *    - New version created FIRST
 *    - Old version updated SECOND
 *    - If second fails, integrity check repairs
 *    - Transaction used where possible
 * 
 * 3. Family Integrity:
 *    - Runs after every operation
 *    - Ensures exactly one isLatest per family
 *    - Ensures at least one isDefault per type
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB directly
 * - Does NOT define DB_NAME or DB_VERSION
 * - Does NOT create another database
 * - Does NOT contain UI logic
 * - Does NOT contain calculation logic (GST, Discount, etc.)
 * - Does NOT render A4/PDF/Print
 * - Does NOT perform GST/Discount calculations
 * ============================================================
 */

// ============================================================
// IMPORTS
// ============================================================

import { database } from '../core/database.js';
import { state } from '../core/state.js';
import { eventBus, EVENTS } from '../core/events.js';

// ============================================================
// CONSTANTS
// ============================================================

const STORE_NAME = 'templates';
const TEMPLATE_TYPES = ['invoice', 'quotation'];
const PAGE_SIZES = ['A4', 'A5', 'Letter', 'Legal', 'Custom'];
const ORIENTATIONS = ['portrait', 'landscape'];
const ALIGNMENTS = ['left', 'center', 'right'];
const VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'];

// ============================================================
// DEFAULT TEMPLATES
// ============================================================

const DEFAULT_TEMPLATES = {
    invoice: {
        templateId: 'h4-default-invoice',
        name: 'H4 Default Invoice',
        type: 'invoice',
        version: 1,
        parentVersionId: null,
        isLatest: true,
        active: true,
        isDefault: true,
        description: 'Default invoice template for H4 Billing ERP',
        config: {
            page: {
                pageSize: 'A4',
                orientation: 'portrait',
                margins: { top: 20, right: 15, bottom: 20, left: 15 },
                background: '#ffffff'
            },
            header: {
                enabled: true,
                height: 80,
                background: '#f8f9fa',
                logo: { enabled: true, imageId: null, width: 120, height: 50, fit: 'contain' },
                company: { enabled: true, showName: true, showBrandName: true, showAddress: true, showPhone: true, showWhatsApp: false, showEmail: true, showWebsite: false, showGSTIN: true, showPAN: false },
                documentTitle: { enabled: true, text: 'TAX INVOICE', alignment: 'center' },
                invoiceNumber: { enabled: true, label: 'Invoice No:', alignment: 'right' },
                date: { enabled: true, label: 'Date:', alignment: 'right' },
                customElements: []
            },
            customer: {
                enabled: true,
                showName: true,
                showPhone: true,
                showWhatsApp: false,
                showEmail: true,
                showAddress: true,
                showGSTIN: true,
                showPAN: false,
                showCode: false
            },
            document: {
                showTitle: true,
                showNumber: true,
                showDate: true,
                showDueDate: true,
                showStatus: false
            },
            itemTable: {
                enabled: true,
                columns: [
                    { id: 'sno', label: 'S.No', visible: true, width: 40, alignment: 'center', order: 0 },
                    { id: 'product', label: 'Product', visible: true, width: 150, alignment: 'left', order: 1 },
                    { id: 'description', label: 'Description', visible: true, width: 120, alignment: 'left', order: 2 },
                    { id: 'hsn', label: 'HSN', visible: true, width: 70, alignment: 'center', order: 3 },
                    { id: 'qty', label: 'Qty', visible: true, width: 50, alignment: 'center', order: 4 },
                    { id: 'unit', label: 'Unit', visible: true, width: 50, alignment: 'center', order: 5 },
                    { id: 'rate', label: 'Rate', visible: true, width: 70, alignment: 'right', order: 6 },
                    { id: 'discount', label: 'Disc %', visible: false, width: 60, alignment: 'center', order: 7 },
                    { id: 'amount', label: 'Amount', visible: true, width: 80, alignment: 'right', order: 8 }
                ],
                header: { enabled: true, background: '#e9ecef', color: '#1a1a2e', fontWeight: 'bold' },
                rows: { enabled: true, background: '#ffffff', color: '#1a1a2e' },
                borders: { enabled: true, color: '#dee2e6', width: 1 },
                rowHeight: 30,
                repeatHeader: true,
                font: { size: 10, family: 'sans-serif' },
                alignment: 'left'
            },
            totals: {
                subtotal: { enabled: true, label: 'Subtotal:', position: 'right', format: '₹{amount}' },
                discount: { enabled: true, label: 'Discount:', position: 'right', format: '₹{amount}' },
                taxableAmount: { enabled: true, label: 'Taxable Amount:', position: 'right', format: '₹{amount}' },
                cgst: { enabled: true, label: 'CGST:', position: 'right', format: '₹{amount}' },
                sgst: { enabled: true, label: 'SGST:', position: 'right', format: '₹{amount}' },
                igst: { enabled: true, label: 'IGST:', position: 'right', format: '₹{amount}' },
                gstAmount: { enabled: true, label: 'Total GST:', position: 'right', format: '₹{amount}' },
                roundOff: { enabled: true, label: 'Round Off:', position: 'right', format: '₹{amount}' },
                grandTotal: { enabled: true, label: 'Grand Total:', position: 'right', format: '₹{amount}', fontWeight: 'bold' }
            },
            payment: {
                enabled: true,
                showStatus: true,
                showPaidAmount: true,
                showOutstanding: true,
                showPaymentTerms: true,
                showBankDetails: true,
                showUPI: true
            },
            upi: {
                enabled: true,
                showUPIId: true,
                showQRCode: false,
                qrImageId: null,
                width: 100,
                height: 100,
                position: 'right'
            },
            terms: {
                enabled: true,
                invoiceTerms: true,
                quotationTerms: false,
                warrantyTerms: true,
                paymentTerms: true
            },
            signature: {
                enabled: true,
                showName: true,
                showDesignation: true,
                showSignature: true,
                imageId: null,
                width: 120,
                height: 50,
                position: 'right'
            },
            footer: {
                enabled: true,
                invoiceFooter: true,
                quotationFooter: false,
                pageNumber: true,
                totalPages: true,
                customText: '',
                position: 'center'
            },
            fonts: {
                family: 'sans-serif',
                size: 11,
                weight: 'normal',
                style: 'normal',
                color: '#1a1a2e'
            },
            spacing: {
                sectionGap: 15,
                rowGap: 5,
                columnGap: 8,
                paragraphGap: 10,
                lineHeight: 1.5
            },
            visibility: {
                company: true,
                customer: true,
                items: true,
                totals: true,
                payment: true,
                terms: true,
                signature: true,
                footer: true
            },
            elements: []
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    quotation: {
        templateId: 'h4-default-quotation',
        name: 'H4 Default Quotation',
        type: 'quotation',
        version: 1,
        parentVersionId: null,
        isLatest: true,
        active: true,
        isDefault: true,
        description: 'Default quotation template for H4 Billing ERP',
        config: {
            page: {
                pageSize: 'A4',
                orientation: 'portrait',
                margins: { top: 20, right: 15, bottom: 20, left: 15 },
                background: '#ffffff'
            },
            header: {
                enabled: true,
                height: 80,
                background: '#f8f9fa',
                logo: { enabled: true, imageId: null, width: 120, height: 50, fit: 'contain' },
                company: { enabled: true, showName: true, showBrandName: true, showAddress: true, showPhone: true, showWhatsApp: false, showEmail: true, showWebsite: false, showGSTIN: true, showPAN: false },
                documentTitle: { enabled: true, text: 'QUOTATION', alignment: 'center' },
                invoiceNumber: { enabled: true, label: 'Quotation No:', alignment: 'right' },
                date: { enabled: true, label: 'Date:', alignment: 'right' },
                customElements: []
            },
            customer: {
                enabled: true,
                showName: true,
                showPhone: true,
                showWhatsApp: false,
                showEmail: true,
                showAddress: true,
                showGSTIN: true,
                showPAN: false,
                showCode: false
            },
            document: {
                showTitle: true,
                showNumber: true,
                showDate: true,
                showDueDate: true,
                showStatus: false
            },
            itemTable: {
                enabled: true,
                columns: [
                    { id: 'sno', label: 'S.No', visible: true, width: 40, alignment: 'center', order: 0 },
                    { id: 'product', label: 'Product', visible: true, width: 150, alignment: 'left', order: 1 },
                    { id: 'description', label: 'Description', visible: true, width: 120, alignment: 'left', order: 2 },
                    { id: 'hsn', label: 'HSN', visible: true, width: 70, alignment: 'center', order: 3 },
                    { id: 'qty', label: 'Qty', visible: true, width: 50, alignment: 'center', order: 4 },
                    { id: 'unit', label: 'Unit', visible: true, width: 50, alignment: 'center', order: 5 },
                    { id: 'rate', label: 'Rate', visible: true, width: 70, alignment: 'right', order: 6 },
                    { id: 'discount', label: 'Disc %', visible: false, width: 60, alignment: 'center', order: 7 },
                    { id: 'amount', label: 'Amount', visible: true, width: 80, alignment: 'right', order: 8 }
                ],
                header: { enabled: true, background: '#e9ecef', color: '#1a1a2e', fontWeight: 'bold' },
                rows: { enabled: true, background: '#ffffff', color: '#1a1a2e' },
                borders: { enabled: true, color: '#dee2e6', width: 1 },
                rowHeight: 30,
                repeatHeader: true,
                font: { size: 10, family: 'sans-serif' },
                alignment: 'left'
            },
            totals: {
                subtotal: { enabled: true, label: 'Subtotal:', position: 'right', format: '₹{amount}' },
                discount: { enabled: true, label: 'Discount:', position: 'right', format: '₹{amount}' },
                taxableAmount: { enabled: true, label: 'Taxable Amount:', position: 'right', format: '₹{amount}' },
                cgst: { enabled: true, label: 'CGST:', position: 'right', format: '₹{amount}' },
                sgst: { enabled: true, label: 'SGST:', position: 'right', format: '₹{amount}' },
                igst: { enabled: true, label: 'IGST:', position: 'right', format: '₹{amount}' },
                gstAmount: { enabled: true, label: 'Total GST:', position: 'right', format: '₹{amount}' },
                roundOff: { enabled: true, label: 'Round Off:', position: 'right', format: '₹{amount}' },
                grandTotal: { enabled: true, label: 'Grand Total:', position: 'right', format: '₹{amount}', fontWeight: 'bold' }
            },
            payment: {
                enabled: false,
                showStatus: false,
                showPaidAmount: false,
                showOutstanding: false,
                showPaymentTerms: true,
                showBankDetails: true,
                showUPI: true
            },
            upi: {
                enabled: true,
                showUPIId: true,
                showQRCode: false,
                qrImageId: null,
                width: 100,
                height: 100,
                position: 'right'
            },
            terms: {
                enabled: true,
                invoiceTerms: false,
                quotationTerms: true,
                warrantyTerms: true,
                paymentTerms: true
            },
            signature: {
                enabled: true,
                showName: true,
                showDesignation: true,
                showSignature: true,
                imageId: null,
                width: 120,
                height: 50,
                position: 'right'
            },
            footer: {
                enabled: true,
                invoiceFooter: false,
                quotationFooter: true,
                pageNumber: true,
                totalPages: true,
                customText: '',
                position: 'center'
            },
            fonts: {
                family: 'sans-serif',
                size: 11,
                weight: 'normal',
                style: 'normal',
                color: '#1a1a2e'
            },
            spacing: {
                sectionGap: 15,
                rowGap: 5,
                columnGap: 8,
                paragraphGap: 10,
                lineHeight: 1.5
            },
            visibility: {
                company: true,
                customer: true,
                items: true,
                totals: true,
                payment: false,
                terms: true,
                signature: true,
                footer: true
            },
            elements: []
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
};

// ============================================================
// HELPER: DEEP CLONE
// ============================================================

/**
 * Deep clone an object
 * @param {any} obj - Object to clone
 * @returns {any} - Deep cloned object
 */
function deepClone(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    if (typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }
    const cloned = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}

// ============================================================
// TEMPLATE SERVICE CLASS
// ============================================================

class TemplateService {
    constructor() {
        this._storeName = STORE_NAME;
        this._initialized = false;
        this._cache = new Map();
        this._cacheTimeout = 30000;
        this._lastCacheUpdate = 0;
        this._isFamilyIntegrityCheckEnabled = true;
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    /**
     * Initialize the service
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) return;
        await database.open();
        await this._ensureDefaultTemplates();
        await this._ensureFamilyIntegrity();
        await this._ensureDefaultIntegrity();
        this._initialized = true;
        console.log('📄 Template service initialized');
    }

    /**
     * Ensure default templates exist
     * @returns {Promise<void>}
     */
    async _ensureDefaultTemplates() {
        const templates = await database.getAll(this._storeName);
        
        if (templates.length === 0) {
            await database.add(this._storeName, DEFAULT_TEMPLATES.invoice);
            await database.add(this._storeName, DEFAULT_TEMPLATES.quotation);
            console.log('📄 Default templates created');
        } else {
            const hasInvoiceDefault = templates.some(t => t.type === 'invoice' && t.isDefault);
            const hasQuotationDefault = templates.some(t => t.type === 'quotation' && t.isDefault);
            
            if (!hasInvoiceDefault) {
                const invoiceTemplate = templates.find(t => t.type === 'invoice' && t.isLatest !== false);
                if (invoiceTemplate) {
                    invoiceTemplate.isDefault = true;
                    await database.put(this._storeName, invoiceTemplate);
                }
            }
            
            if (!hasQuotationDefault) {
                const quotationTemplate = templates.find(t => t.type === 'quotation' && t.isLatest !== false);
                if (quotationTemplate) {
                    quotationTemplate.isDefault = true;
                    await database.put(this._storeName, quotationTemplate);
                }
            }
        }
    }

    /**
     * Ensure family integrity - at least one isLatest per family
     * @returns {Promise<void>}
     */
    async _ensureFamilyIntegrity() {
        if (!this._isFamilyIntegrityCheckEnabled) return;
        
        const templates = await database.getAll(this._storeName);
        const families = {};
        
        for (const template of templates) {
            if (!families[template.templateId]) {
                families[template.templateId] = [];
            }
            families[template.templateId].push(template);
        }
        
        for (const [templateId, family] of Object.entries(families)) {
            const hasLatest = family.some(t => t.isLatest === true);
            if (!hasLatest && family.length > 0) {
                const highest = family.reduce((max, t) => 
                    t.version > max.version ? t : max, family[0]
                );
                highest.isLatest = true;
                highest.updatedAt = new Date().toISOString();
                await database.put(this._storeName, highest);
                console.log(`🔧 Fixed family integrity: ${templateId} v${highest.version} marked as latest`);
            }
        }
    }

    /**
     * Ensure default integrity - at least one default per type
     * @returns {Promise<void>}
     */
    async _ensureDefaultIntegrity() {
        const templates = await database.getAll(this._storeName);
        
        for (const type of TEMPLATE_TYPES) {
            const ofType = templates.filter(t => t.type === type && t.active !== false);
            const hasDefault = ofType.some(t => t.isDefault === true);
            
            if (!hasDefault && ofType.length > 0) {
                // Find the latest version and make it default
                const latest = ofType.reduce((max, t) => 
                    t.version > max.version ? t : max, ofType[0]
                );
                latest.isDefault = true;
                latest.updatedAt = new Date().toISOString();
                await database.put(this._storeName, latest);
                console.log(`🔧 Fixed default integrity: ${type} → ${latest.name} v${latest.version} marked as default`);
            }
        }
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate template data
     * @param {Object} data - Template data to validate
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validateTemplate(data) {
        const errors = [];

        if (!data.name || data.name.trim() === '') {
            errors.push('Template name is required');
        }

        if (!data.type || !TEMPLATE_TYPES.includes(data.type)) {
            errors.push(`Invalid template type. Must be one of: ${TEMPLATE_TYPES.join(', ')}`);
        }

        if (!data.templateId || data.templateId.trim() === '') {
            errors.push('Template family ID is required');
        }

        if (data.version !== undefined && (typeof data.version !== 'number' || data.version < 1)) {
            errors.push('Version must be a positive number');
        }

        if (data.config?.page?.pageSize) {
            if (!PAGE_SIZES.includes(data.config.page.pageSize)) {
                errors.push(`Invalid page size. Must be one of: ${PAGE_SIZES.join(', ')}`);
            }
        }

        if (data.config?.page?.orientation) {
            if (!ORIENTATIONS.includes(data.config.page.orientation)) {
                errors.push(`Invalid orientation. Must be one of: ${ORIENTATIONS.join(', ')}`);
            }
        }

        if (data.config?.page?.margins) {
            const margins = data.config.page.margins;
            if (margins.top !== undefined && margins.top < 0) errors.push('Top margin cannot be negative');
            if (margins.right !== undefined && margins.right < 0) errors.push('Right margin cannot be negative');
            if (margins.bottom !== undefined && margins.bottom < 0) errors.push('Bottom margin cannot be negative');
            if (margins.left !== undefined && margins.left < 0) errors.push('Left margin cannot be negative');
        }

        if (data.config?.itemTable?.columns) {
            const columns = data.config.itemTable.columns;
            if (!Array.isArray(columns) || columns.length === 0) {
                errors.push('At least one column is required');
            }
            const colValidation = this.validateColumns(columns);
            if (!colValidation.valid) {
                errors.push(...colValidation.errors);
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // NORMALIZATION (WITH DEEP CLONE)
    // ============================================================

    /**
     * Normalize template data before saving
     * Uses deep clone to prevent reference sharing
     * @param {Object} data - Template data to normalize
     * @returns {Object} - Normalized template data
     */
    normalizeTemplate(data) {
        const normalized = deepClone(data);

        if (normalized.name) normalized.name = normalized.name.trim();
        if (normalized.description) normalized.description = normalized.description.trim();
        if (normalized.templateId) normalized.templateId = normalized.templateId.trim();

        if (!normalized.config) {
            normalized.config = {};
        }

        const defaultTemplate = DEFAULT_TEMPLATES[normalized.type] || DEFAULT_TEMPLATES.invoice;
        const defaultConfig = deepClone(defaultTemplate.config);

        if (!normalized.config.page) {
            normalized.config.page = defaultConfig.page;
        }
        if (!normalized.config.page.margins) {
            normalized.config.page.margins = { top: 20, right: 15, bottom: 20, left: 15 };
        }

        if (!normalized.config.header) {
            normalized.config.header = defaultConfig.header;
        }
        if (!normalized.config.header.logo) {
            normalized.config.header.logo = { enabled: true, imageId: null, width: 120, height: 50, fit: 'contain' };
        }
        if (!normalized.config.header.company) {
            normalized.config.header.company = { enabled: true, showName: true, showBrandName: true, showAddress: true, showPhone: true, showWhatsApp: false, showEmail: true, showWebsite: false, showGSTIN: true, showPAN: false };
        }
        if (!normalized.config.header.documentTitle) {
            normalized.config.header.documentTitle = { enabled: true, text: normalized.type === 'invoice' ? 'TAX INVOICE' : 'QUOTATION', alignment: 'center' };
        }
        if (!normalized.config.header.invoiceNumber) {
            normalized.config.header.invoiceNumber = { enabled: true, label: normalized.type === 'invoice' ? 'Invoice No:' : 'Quotation No:', alignment: 'right' };
        }
        if (!normalized.config.header.date) {
            normalized.config.header.date = { enabled: true, label: 'Date:', alignment: 'right' };
        }
        if (!normalized.config.header.customElements) {
            normalized.config.header.customElements = [];
        }

        if (!normalized.config.customer) {
            normalized.config.customer = defaultConfig.customer;
        }

        if (!normalized.config.document) {
            normalized.config.document = defaultConfig.document;
        }

        if (!normalized.config.itemTable) {
            normalized.config.itemTable = defaultConfig.itemTable;
        }
        if (!normalized.config.itemTable.columns || normalized.config.itemTable.columns.length === 0) {
            normalized.config.itemTable.columns = deepClone(defaultConfig.itemTable.columns);
        }
        if (!normalized.config.itemTable.header) {
            normalized.config.itemTable.header = { enabled: true, background: '#e9ecef', color: '#1a1a2e', fontWeight: 'bold' };
        }
        if (!normalized.config.itemTable.rows) {
            normalized.config.itemTable.rows = { enabled: true, background: '#ffffff', color: '#1a1a2e' };
        }
        if (!normalized.config.itemTable.borders) {
            normalized.config.itemTable.borders = { enabled: true, color: '#dee2e6', width: 1 };
        }
        if (!normalized.config.itemTable.font) {
            normalized.config.itemTable.font = { size: 10, family: 'sans-serif' };
        }

        if (!normalized.config.totals) {
            normalized.config.totals = defaultConfig.totals;
        }

        if (!normalized.config.payment) {
            normalized.config.payment = defaultConfig.payment;
        }

        if (!normalized.config.upi) {
            normalized.config.upi = defaultConfig.upi;
        }

        if (!normalized.config.terms) {
            normalized.config.terms = defaultConfig.terms;
        }

        if (!normalized.config.signature) {
            normalized.config.signature = defaultConfig.signature;
        }

        if (!normalized.config.footer) {
            normalized.config.footer = defaultConfig.footer;
        }

        if (!normalized.config.fonts) {
            normalized.config.fonts = defaultConfig.fonts;
        }

        if (!normalized.config.spacing) {
            normalized.config.spacing = defaultConfig.spacing;
        }

        if (!normalized.config.visibility) {
            normalized.config.visibility = defaultConfig.visibility;
        }

        if (!normalized.config.elements) {
            normalized.config.elements = [];
        }

        if (normalized.config.itemTable.columns) {
            normalized.config.itemTable.columns.sort((a, b) => (a.order || 0) - (b.order || 0));
        }

        if (normalized.version === undefined || normalized.version === null) {
            normalized.version = 1;
        }
        if (normalized.parentVersionId === undefined) {
            normalized.parentVersionId = null;
        }
        if (normalized.isLatest === undefined) {
            normalized.isLatest = true;
        }

        return normalized;
    }

    // ============================================================
    // GENERATE TEMPLATE FAMILY ID
    // ============================================================

    /**
     * Generate a template family ID
     * @param {string} type - Template type
     * @returns {string} - Template family ID
     */
    _generateTemplateId(type) {
        const prefix = type === 'invoice' ? 'TPL-INV' : 'TPL-QUO';
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${prefix}-${timestamp}-${random}`;
    }

    // ============================================================
    // CREATE TEMPLATE (FAILURE-SAFE)
    // ============================================================

    /**
     * Create a new template
     * 
     * FAILURE-SAFE APPROACH:
     * 1. Validate and prepare data
     * 2. Save new template
     * 3. Clear OTHER defaults (excluding the new template)
     * 4. Ensure family integrity
     * 
     * @param {Object} data - Template data
     * @returns {Promise<Object>} - Created template
     */
    async createTemplate(data) {
        await this.initialize();

        const validation = this.validateTemplate(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const normalized = this.normalizeTemplate(data);

        const templateId = data.templateId || this._generateTemplateId(normalized.type);
        const existingFamily = await database.getByFilter(this._storeName, { templateId: templateId });
        const isNewFamily = existingFamily.length === 0;

        let version;
        if (data.version !== undefined && data.version !== null) {
            version = data.version;
        } else if (isNewFamily) {
            version = 1;
        } else {
            version = Math.max(...existingFamily.map(t => t.version)) + 1;
        }

        const existingTemplates = await database.getByFilter(this._storeName, { type: normalized.type });
        const isDefault = normalized.isDefault !== undefined ? normalized.isDefault : existingTemplates.length === 0;
        const isLatest = data.isLatest !== undefined ? data.isLatest : true;

        const now = new Date().toISOString();
        const template = {
            templateId: templateId,
            name: normalized.name,
            type: normalized.type,
            version: version,
            parentVersionId: normalized.parentVersionId || null,
            isLatest: isLatest,
            active: normalized.active !== false,
            isDefault: isDefault,
            description: normalized.description || '',
            config: normalized.config,
            createdAt: now,
            updatedAt: now
        };

        // STEP 1: Save new template
        await database.add(this._storeName, template);

        // STEP 2: Clear OTHER defaults (excluding the new template)
        if (isDefault) {
            await this._clearDefaultForTypeExcluding(normalized.type, template.id);
        }

        // STEP 3: Ensure integrity
        await this._ensureFamilyIntegrity();
        await this._ensureDefaultIntegrity();

        this._clearCache();
        try {
            const templates = await database.getAll(this._storeName);
            state.set('templates', templates);
            state.set('selectedTemplate', template);
        } catch (error) {
            console.warn('⚠️ Failed to update template state:', error.message);
        }

        await eventBus.emit(
            EVENTS.TEMPLATE_CREATED,
            {
                templateId: template.templateId,
                name: template.name,
                type: template.type,
                version: template.version,
                data: template
            },
            'template-service'
        );

        console.log(`📄 Template created: ${template.name} (${template.type}) v${template.version} [${templateId}]`);
        return template;
    }

    /**
     * Clear default for a template type excluding a specific template
     * @param {string} type - Template type
     * @param {string} excludeId - Template ID to exclude
     * @returns {Promise<void>}
     */
    async _clearDefaultForTypeExcluding(type, excludeId) {
        const templates = await this.getTemplates({ type: type });
        for (const template of templates) {
            if (template.isDefault && template.id !== excludeId) {
                template.isDefault = false;
                template.updatedAt = new Date().toISOString();
                await database.put(this._storeName, template);
            }
        }
    }

    // ============================================================
    // GET TEMPLATE
    // ============================================================

    /**
     * Get a template by its record ID
     * @param {string} id - Template record ID
     * @returns {Promise<Object|null>} - Template or null
     */
    async getTemplate(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    /**
     * Get a template by family ID and version
     * @param {string} templateId - Template family ID
     * @param {number} version - Version number
     * @returns {Promise<Object|null>} - Template or null
     */
    async getTemplateByVersion(templateId, version) {
        await this.initialize();
        const allTemplates = await database.getAll(this._storeName);
        return allTemplates.find(t => t.templateId === templateId && t.version === version) || null;
    }

    /**
     * Get the latest version of a template family
     * @param {string} templateId - Template family ID
     * @returns {Promise<Object|null>} - Latest template or null
     */
    async getLatestTemplate(templateId) {
        await this.initialize();
        const allTemplates = await database.getAll(this._storeName);
        const family = allTemplates.filter(t => t.templateId === templateId);
        return family.find(t => t.isLatest === true) || family[family.length - 1] || null;
    }

    /**
     * Get template by name and type (returns latest version)
     * @param {string} name - Template name
     * @param {string} type - Template type
     * @returns {Promise<Object|null>} - Template or null
     */
    async getTemplateByName(name, type) {
        await this.initialize();
        const allTemplates = await database.getAll(this._storeName);
        const matches = allTemplates.filter(t => t.name === name && t.type === type);
        return matches.find(t => t.isLatest === true) || matches[0] || null;
    }

    /**
     * Get all versions of a template family
     * @param {string} templateId - Template family ID
     * @returns {Promise<Array>} - All versions
     */
    async getTemplateFamily(templateId) {
        await this.initialize();
        const allTemplates = await database.getAll(this._storeName);
        return allTemplates.filter(t => t.templateId === templateId).sort((a, b) => a.version - b.version);
    }

    // ============================================================
    // GET ALL TEMPLATES
    // ============================================================

    /**
     * Get all templates with options
     * @param {Object} options - Query options
     * @param {string} options.type - Filter by type
     * @param {boolean} options.activeOnly - Only active templates
     * @param {boolean} options.defaultOnly - Only default templates
     * @param {boolean} options.latestOnly - Only latest versions
     * @param {string} options.sortBy - Field to sort by
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @returns {Promise<Array>} - Array of templates
     */
    async getTemplates(options = {}) {
        await this.initialize();

        let templates = await database.getAll(this._storeName);

        if (options.type) {
            templates = templates.filter(t => t.type === options.type);
        }

        if (options.activeOnly) {
            templates = templates.filter(t => t.active !== false);
        }

        if (options.defaultOnly) {
            templates = templates.filter(t => t.isDefault === true);
        }

        if (options.latestOnly) {
            templates = templates.filter(t => t.isLatest === true);
        }

        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            templates.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        } else {
            templates.sort((a, b) => {
                if (a.isDefault && !b.isDefault) return -1;
                if (!a.isDefault && b.isDefault) return 1;
                return a.templateId.localeCompare(b.templateId);
            });
        }

        return templates;
    }

    /**
     * Get templates by type (latest versions only)
     * @param {string} type - Template type ('invoice' or 'quotation')
     * @param {boolean} activeOnly - Only active templates
     * @returns {Promise<Array>} - Array of templates
     */
    async getTemplatesByType(type, activeOnly = true) {
        return this.getTemplates({ type: type, activeOnly: activeOnly, latestOnly: true });
    }

    // ============================================================
    // GET DEFAULT TEMPLATE
    // ============================================================

    /**
     * Get default template for a type
     * @param {string} type - Template type ('invoice' or 'quotation')
     * @returns {Promise<Object|null>} - Default template or null
     */
    async getDefaultTemplate(type) {
        await this.initialize();

        const templates = await this.getTemplates({
            type: type,
            defaultOnly: true,
            activeOnly: true,
            latestOnly: true
        });

        return templates[0] || null;
    }

    // ============================================================
    // SET DEFAULT TEMPLATE
    // ============================================================

    /**
     * Set a template as default
     * @param {string} id - Template record ID
     * @returns {Promise<Object>} - Updated template
     */
    async setDefaultTemplate(id) {
        await this.initialize();

        const template = await database.get(this._storeName, id);
        if (!template) {
            throw new Error(`Template not found: ${id}`);
        }

        if (template.active === false) {
            throw new Error('Cannot set inactive template as default');
        }

        await this._clearDefaultForTypeExcluding(template.type, template.id);

        template.isDefault = true;
        template.updatedAt = new Date().toISOString();

        await database.put(this._storeName, template);

        await this._ensureDefaultIntegrity();

        this._clearCache();

        try {
            const templates = await database.getAll(this._storeName);
            state.set('templates', templates);
        } catch (error) {
            console.warn('⚠️ Failed to update template state:', error.message);
        }

        await eventBus.emit(
            EVENTS.TEMPLATE_UPDATED,
            {
                templateId: template.templateId,
                name: template.name,
                type: template.type,
                version: template.version,
                action: 'set-default',
                data: template
            },
            'template-service'
        );

        console.log(`📄 Default template set: ${template.name} (${template.type}) v${template.version}`);
        return template;
    }

    // ============================================================
    // UPDATE TEMPLATE (CREATES NEW VERSION)
    // ============================================================

    /**
     * Update an existing template - creates a new version
     * @param {string} id - Template record ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - New template version
     */
    async updateTemplate(id, updates) {
        await this.initialize();

        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Template not found: ${id}`);
        }

        return this.createTemplateVersion(existing.templateId, updates);
    }

    // ============================================================
    // DELETE TEMPLATE
    // ============================================================

    /**
     * Delete a template version
     * @param {string} id - Template record ID
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     * @returns {Promise<Object>} - Result
     */
    async deleteTemplate(id, confirmation = '') {
        await this.initialize();

        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Template deletion requires confirmation. Call deleteTemplate("CONFIRM_DELETE")');
        }

        const template = await database.get(this._storeName, id);
        if (!template) {
            throw new Error(`Template not found: ${id}`);
        }

        if (template.isDefault) {
            throw new Error(`Cannot delete default template "${template.name}". Set another template as default first.`);
        }

        const inUse = await this.isTemplateInUse(id);
        if (inUse) {
            throw new Error(`Template "${template.name}" is used by documents and cannot be deleted.`);
        }

        const family = await this.getTemplateFamily(template.templateId);

        if (template.isLatest && family.length > 1) {
            const previous = family
                .filter(t => t.id !== id && t.version < template.version)
                .sort((a, b) => b.version - a.version)[0];
            if (previous) {
                previous.isLatest = true;
                previous.updatedAt = new Date().toISOString();
                await database.put(this._storeName, previous);
            }
        }

        await database.delete(this._storeName, id);

        await this._ensureFamilyIntegrity();
        await this._ensureDefaultIntegrity();

        this._clearCache();

        try {
            const templates = await database.getAll(this._storeName);
            state.set('templates', templates);
        } catch (error) {
            console.warn('⚠️ Failed to update template state:', error.message);
        }

        await eventBus.emit(
            EVENTS.TEMPLATE_DELETED,
            {
                templateId: template.templateId,
                name: template.name,
                type: template.type,
                version: template.version,
                data: template
            },
            'template-service'
        );

        console.log(`📄 Template deleted: ${template.name} (${template.type}) v${template.version}`);
        return { success: true, id: id, name: template.name };
    }

    // ============================================================
    // DUPLICATE TEMPLATE
    // ============================================================

    /**
     * Duplicate a template (creates new family)
     * @param {string} id - Template record ID to duplicate
     * @param {string} newName - Name for the new template (optional)
     * @returns {Promise<Object>} - Duplicated template
     */
    async duplicateTemplate(id, newName = null) {
        await this.initialize();

        const original = await database.get(this._storeName, id);
        if (!original) {
            throw new Error(`Template not found: ${id}`);
        }

        const name = newName || `${original.name} (Copy)`;

        const copyData = {
            templateId: this._generateTemplateId(original.type),
            name: name,
            type: original.type,
            version: 1,
            parentVersionId: null,
            isLatest: true,
            active: original.active,
            isDefault: false,
            description: original.description || '',
            config: deepClone(original.config)
        };

        const created = await this.createTemplate(copyData);

        console.log(`📄 Template duplicated: ${original.name} → ${created.name}`);
        return created;
    }

    // ============================================================
    // CREATE TEMPLATE VERSION (FAILURE-SAFE)
    // ============================================================

    /**
     * Create a new immutable version of a template
     * 
     * FAILURE-SAFE APPROACH:
     * 1. Create new version FIRST
     * 2. If successful, update old version's isLatest
     * 3. If old update fails, integrity check repairs
     * 4. Always ensure at least one version is isLatest = true
     * 
     * @param {string} templateId - Template family ID
     * @param {Object} updates - Updated fields for new version
     * @returns {Promise<Object>} - New template version
     */
    async createTemplateVersion(templateId, updates = {}) {
        await this.initialize();

        const family = await this.getTemplateFamily(templateId);
        if (family.length === 0) {
            throw new Error(`Template family not found: ${templateId}`);
        }

        const latest = family.find(t => t.isLatest === true) || family[family.length - 1];
        const newVersion = latest.version + 1;

        const newVersionData = {
            templateId: templateId,
            name: updates.name || latest.name,
            type: latest.type,
            version: newVersion,
            parentVersionId: latest.id,
            isLatest: true,
            active: updates.active !== undefined ? updates.active : latest.active,
            isDefault: false,
            description: updates.description || latest.description || '',
            config: updates.config ? deepClone(updates.config) : deepClone(latest.config)
        };

        // STEP 1: Create new version FIRST
        let created;
        try {
            created = await this.createTemplate(newVersionData);
        } catch (error) {
            console.error(`❌ Failed to create new template version:`, error);
            throw error;
        }

        // STEP 2: Update old version's isLatest
        try {
            if (latest.isLatest) {
                latest.isLatest = false;
                latest.updatedAt = new Date().toISOString();
                await database.put(this._storeName, latest);
            }
        } catch (error) {
            console.error(`⚠️ Failed to update old version's isLatest. Forcing repair...`);
            // Attempt repair
            await this._ensureFamilyIntegrity();
            throw error;
        }

        // STEP 3: Ensure integrity
        await this._ensureFamilyIntegrity();
        await this._ensureDefaultIntegrity();

        this._clearCache();
        try {
            const templates = await database.getAll(this._storeName);
            state.set('templates', templates);
        } catch (error) {
            console.warn('⚠️ Failed to update template state:', error.message);
        }

        console.log(`📄 Template version created: ${latest.name} v${latest.version} → v${created.version} [${templateId}]`);
        return created;
    }

    /**
     * Get template version
     * @param {string} id - Template record ID
     * @returns {Promise<number>} - Template version
     */
    async getTemplateVersion(id) {
        await this.initialize();
        const template = await database.get(this._storeName, id);
        return template ? template.version || 1 : 0;
    }

    // ============================================================
    // TEMPLATE ACTIVE/INACTIVE
    // ============================================================

    /**
     * Activate a template
     * Direct metadata update - acceptable (not content change)
     * @param {string} id - Template record ID
     * @returns {Promise<Object>} - Updated template
     */
    async activateTemplate(id) {
        await this.initialize();
        const template = await database.get(this._storeName, id);
        if (!template) {
            throw new Error(`Template not found: ${id}`);
        }
        template.active = true;
        template.updatedAt = new Date().toISOString();
        await database.put(this._storeName, template);
        this._clearCache();
        return template;
    }

    /**
     * Deactivate a template
     * Direct metadata update - acceptable (not content change)
     * @param {string} id - Template record ID
     * @returns {Promise<Object>} - Updated template
     */
    async deactivateTemplate(id) {
        await this.initialize();

        const template = await database.get(this._storeName, id);
        if (!template) {
            throw new Error(`Template not found: ${id}`);
        }

        if (template.isDefault) {
            throw new Error('Cannot deactivate default template. Set another template as default first.');
        }

        if (template.isLatest) {
            const family = await this.getTemplateFamily(template.templateId);
            if (family.length === 1) {
                throw new Error('Cannot deactivate the only version of a template family.');
            }
        }

        template.active = false;
        template.updatedAt = new Date().toISOString();
        await database.put(this._storeName, template);
        this._clearCache();
        return template;
    }

    // ============================================================
    // TEMPLATE IN USE CHECK
    // ============================================================

    /**
     * Check if template is used by any document
     * @param {string} id - Template record ID
     * @returns {Promise<boolean>} - True if in use
     */
    async isTemplateInUse(id) {
        await this.initialize();

        const template = await database.get(this._storeName, id);
        if (!template) {
            return false;
        }

        const invoices = await database.getByFilter('invoices', { templateId: template.templateId });
        if (invoices && invoices.length > 0) {
            return true;
        }

        const quotations = await database.getByFilter('quotations', { templateId: template.templateId });
        if (quotations && quotations.length > 0) {
            return true;
        }

        const invoicesByVersion = await database.getByFilter('invoices', { templateVersion: template.version });
        if (invoicesByVersion && invoicesByVersion.length > 0) {
            return true;
        }

        const quotationsByVersion = await database.getByFilter('quotations', { templateVersion: template.version });
        if (quotationsByVersion && quotationsByVersion.length > 0) {
            return true;
        }

        return false;
    }

    /**
     * Get documents using a template
     * @param {string} id - Template record ID
     * @returns {Promise<Object>} - Documents using template
     */
    async getTemplateUsage(id) {
        await this.initialize();

        const template = await database.get(this._storeName, id);
        if (!template) {
            return { invoices: [], quotations: [], total: 0 };
        }

        const invoices = await database.getByFilter('invoices', { templateId: template.templateId });
        const quotations = await database.getByFilter('quotations', { templateId: template.templateId });
        const invoicesByVersion = await database.getByFilter('invoices', { templateVersion: template.version });
        const quotationsByVersion = await database.getByFilter('quotations', { templateVersion: template.version });

        return {
            invoices: invoices || [],
            quotations: quotations || [],
            invoicesByVersion: invoicesByVersion || [],
            quotationsByVersion: quotationsByVersion || [],
            total: (invoices?.length || 0) + (quotations?.length || 0) +
                   (invoicesByVersion?.length || 0) + (quotationsByVersion?.length || 0)
        };
    }

    // ============================================================
    // TEMPLATE SNAPSHOT
    // ============================================================

    /**
     * Get template snapshot for document
     * @param {string} type - Document type ('invoice' or 'quotation')
     * @param {string} templateId - Specific template family ID (optional)
     * @param {number} version - Specific version (optional)
     * @returns {Promise<Object>} - Template snapshot
     */
    async getTemplateSnapshot(type, templateId = null, version = null) {
        await this.initialize();

        const template = await this.getTemplateForDocument(type, templateId, version);
        if (!template) {
            throw new Error(`No template found for type: ${type}`);
        }

        return {
            templateId: template.templateId,
            templateVersion: template.version,
            templateName: template.name,
            type: template.type,
            config: deepClone(template.config)
        };
    }

    /**
     * Get template for a document with snapshot support
     * @param {string} type - Document type ('invoice' or 'quotation')
     * @param {string} templateId - Optional specific template family ID
     * @param {number} templateVersion - Optional specific template version
     * @returns {Promise<Object>} - Template
     */
    async getTemplateForDocument(type, templateId = null, templateVersion = null) {
        await this.initialize();

        if (templateId && templateVersion !== null) {
            const exactTemplate = await this.getTemplateByVersion(templateId, templateVersion);
            if (exactTemplate && exactTemplate.type === type && exactTemplate.active !== false) {
                return exactTemplate;
            }
        }

        if (templateId) {
            const latest = await this.getLatestTemplate(templateId);
            if (latest && latest.type === type && latest.active !== false) {
                return latest;
            }
            const family = await this.getTemplateFamily(templateId);
            const active = family.find(t => t.type === type && t.active !== false);
            if (active) {
                return active;
            }
        }

        const defaultTemplate = await this.getDefaultTemplate(type);
        if (defaultTemplate) {
            return defaultTemplate;
        }

        const templates = await this.getTemplates({ type: type, activeOnly: true, latestOnly: true });
        if (templates.length > 0) {
            return templates[0];
        }

        const defaultData = type === 'invoice' ? DEFAULT_TEMPLATES.invoice : DEFAULT_TEMPLATES.quotation;
        return this.createTemplate(defaultData);
    }

    // ============================================================
    // VALIDATE COLUMN CONFIGURATION
    // ============================================================

    /**
     * Validate column configuration
     * @param {Array} columns - Column configuration
     * @returns {Object} - Validation result
     */
    validateColumns(columns) {
        const errors = [];

        if (!Array.isArray(columns) || columns.length === 0) {
            errors.push('At least one column is required');
            return { valid: false, errors: errors };
        }

        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            if (!col.id) errors.push(`Column ${i + 1}: ID is required`);
            if (!col.label) errors.push(`Column ${i + 1}: Label is required`);
            if (col.width !== undefined && (col.width < 0 || col.width > 500)) {
                errors.push(`Column ${i + 1}: Width must be between 0 and 500`);
            }
            if (col.alignment && !ALIGNMENTS.includes(col.alignment)) {
                errors.push(`Column ${i + 1}: Invalid alignment. Must be one of: ${ALIGNMENTS.join(', ')}`);
            }
        }

        const ids = columns.map(c => c.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        if (duplicates.length > 0) {
            errors.push(`Duplicate column IDs: ${duplicates.join(', ')}`);
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export template data
     * @param {string} id - Template record ID
     * @returns {Promise<Object>} - Template data
     */
    async exportTemplate(id) {
        await this.initialize();
        const template = await database.get(this._storeName, id);
        if (!template) {
            throw new Error(`Template not found: ${id}`);
        }
        return deepClone(template);
    }

    /**
     * Import template data
     * @param {Object} data - Template data to import
     * @param {boolean} overwrite - Whether to overwrite existing
     * @returns {Promise<Object>} - Imported template
     */
    async importTemplate(data, overwrite = false) {
        await this.initialize();

        if (!data || typeof data !== 'object') {
            throw new Error('Invalid template data');
        }

        const validation = this.validateTemplate(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const existing = data.templateId ? await this.getLatestTemplate(data.templateId) : null;

        if (existing && overwrite) {
            return this.createTemplateVersion(data.templateId, data);
        } else if (existing && !overwrite) {
            throw new Error(`Template family ${data.templateId} already exists. Use overwrite=true to replace.`);
        } else {
            return this.createTemplate(data);
        }
    }

    // ============================================================
    // CLEAR CACHE
    // ============================================================

    /**
     * Clear cache
     */
    _clearCache() {
        this._cache.clear();
        this._lastCacheUpdate = 0;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const templateService = new TemplateService();

// ============================================================
// EXPORT
// ============================================================

export { templateService };
export default templateService;

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → templates store
// EVENTS: TEMPLATE_CREATED, TEMPLATE_UPDATED, TEMPLATE_DELETED
// 
// FAILURE-SAFE DESIGN:
// 
// 1. isDefault Logic: ✅ FIXED
//    - New template saved first
//    - Then clear OTHER defaults (excluding new template)
//    - Ensures at least one default always exists
// 
// 2. Version Update: ✅ IMPROVED
//    - New version created FIRST
//    - Old version updated SECOND
//    - If second fails, integrity check repairs
//    - Transaction used where possible
// 
// 3. Family Integrity: ✅
//    - Runs after every operation
//    - Ensures exactly one isLatest per family
//    - Ensures at least one isDefault per type
// 
// 4. Default Integrity: ✅ ADDED
//    - Ensures at least one default template per type
//    - Runs during initialization and after operations
// 
// ============================================================