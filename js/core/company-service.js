/**
 * H4 Billing ERP - Company Service Module
 * Central service for company profile operations
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * company-service.js provides a clean API for company CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: company
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.COMPANY_UPDATED (when company is created or updated)
 * - EVENTS.COMPANY_DELETED (when company is deleted)
 * 
 * ============================================================
 * COMPANY DATA MODEL
 * ============================================================
 * 
 * id                    - Unique company ID (singleton: 'company')
 * companyName           - Legal company name
 * brandName             - Customer-facing brand name
 * address               - Company address
 * city                  - City
 * district              - District
 * state                 - State
 * pincode               - PIN code
 * phone                 - Primary contact number
 * whatsapp              - WhatsApp number
 * email                 - Email address
 * website               - Website URL
 * gstin                 - GSTIN
 * pan                   - PAN
 * companyLogoId         - Reference to company logo image
 * brandLogoId           - Reference to brand logo image
 * signatureImageId      - Reference to signature image
 * bankDetails           - Bank configuration
 * upiDetails            - UPI configuration
 * authorizedSignatory   - Signatory configuration
 * invoiceTerms          - Invoice terms
 * quotationTerms        - Quotation terms
 * warrantyTerms         - Warranty terms
 * paymentTerms          - Payment terms
 * invoiceFooter         - Invoice footer
 * quotationFooter       - Quotation footer
 * createdAt             - Creation timestamp
 * updatedAt             - Last update timestamp
 * 
 * ============================================================
 * WHAT IT DOES NOT DO
 * ============================================================
 * 
 * - Does NOT open IndexedDB directly
 * - Does NOT define DB_NAME or DB_VERSION
 * - Does NOT create another database
 * - Does NOT contain UI logic
 * - Does NOT contain calculation logic
 * - Does NOT generate PDF/Print/WhatsApp
 * - Does NOT modify other stores (customers, products, etc.)
 * ============================================================
 */

// ============================================================
// IMPORTS
// ============================================================

import { database } from '../core/database.js';
import { eventBus, EVENTS } from '../core/events.js';
import { state } from '../core/state.js';

// ============================================================
// CONSTANTS
// ============================================================

const STORE_NAME = 'company';
const COMPANY_ID = 'company';

// ============================================================
// COMPANY SERVICE CLASS
// ============================================================

class CompanyService {
    constructor() {
        this._storeName = STORE_NAME;
        this._companyId = COMPANY_ID;
        this._initialized = false;
        this._cache = null;
        this._cacheTimeout = 30000; // 30 seconds
        this._lastCacheUpdate = 0;
    }

    /**
     * Initialize the service
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) return;
        await database.open();
        this._initialized = true;
        console.log('🏢 Company service initialized');
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate company data
     * @param {Object} data - Company data to validate
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validateCompany(data) {
        const errors = [];

        // Company name is required
        if (!data.companyName || data.companyName.trim() === '') {
            errors.push('Company name is required');
        }

        // Email validation (if provided)
        if (data.email && data.email.trim() !== '') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.email)) {
                errors.push('Invalid email format');
            }
        }

        // Phone validation (if provided)
        if (data.phone && data.phone.trim() !== '') {
            const phoneRegex = /^[0-9+\-\s()]{10,15}$/;
            if (!phoneRegex.test(data.phone.replace(/\s/g, ''))) {
                errors.push('Invalid phone number format');
            }
        }

        // GSTIN validation (if provided)
        if (data.gstin && data.gstin.trim() !== '') {
            const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;
            if (!gstinRegex.test(data.gstin.toUpperCase())) {
                errors.push('Invalid GSTIN format');
            }
        }

        // PAN validation (if provided)
        if (data.pan && data.pan.trim() !== '') {
            const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
            if (!panRegex.test(data.pan.toUpperCase())) {
                errors.push('Invalid PAN format');
            }
        }

        // Pincode validation (if provided)
        if (data.pincode && data.pincode.trim() !== '') {
            const pincodeRegex = /^[0-9]{6}$/;
            if (!pincodeRegex.test(data.pincode)) {
                errors.push('Invalid PIN code format (must be 6 digits)');
            }
        }

        // Bank details validation (if bank is enabled)
        if (data.bankDetails && data.bankDetails.enabled) {
            const bank = data.bankDetails;
            if (!bank.bankName || bank.bankName.trim() === '') {
                errors.push('Bank name is required when bank details are enabled');
            }
            if (!bank.accountNumber || bank.accountNumber.trim() === '') {
                errors.push('Account number is required when bank details are enabled');
            }
            if (!bank.ifsc || bank.ifsc.trim() === '') {
                errors.push('IFSC code is required when bank details are enabled');
            }
        }

        // UPI details validation (if UPI is enabled)
        if (data.upiDetails && data.upiDetails.enabled) {
            const upi = data.upiDetails;
            if (!upi.upiId || upi.upiId.trim() === '') {
                errors.push('UPI ID is required when UPI is enabled');
            }
        }

        // Authorized signatory validation (if enabled)
        if (data.authorizedSignatory && data.authorizedSignatory.enabled) {
            const signatory = data.authorizedSignatory;
            if (!signatory.name || signatory.name.trim() === '') {
                errors.push('Signatory name is required when signatory is enabled');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // NORMALIZATION
    // ============================================================

    /**
     * Normalize company data before saving
     * @param {Object} data - Company data to normalize
     * @returns {Object} - Normalized company data
     */
    normalizeCompany(data) {
        const normalized = { ...data };

        // Trim string fields
        if (normalized.companyName) normalized.companyName = normalized.companyName.trim();
        if (normalized.brandName) normalized.brandName = normalized.brandName.trim();
        if (normalized.address) normalized.address = normalized.address.trim();
        if (normalized.city) normalized.city = normalized.city.trim();
        if (normalized.district) normalized.district = normalized.district.trim();
        if (normalized.state) normalized.state = normalized.state.trim();
        if (normalized.pincode) normalized.pincode = normalized.pincode.trim();
        if (normalized.phone) normalized.phone = normalized.phone.trim();
        if (normalized.whatsapp) normalized.whatsapp = normalized.whatsapp.trim();
        if (normalized.email) normalized.email = normalized.email.trim().toLowerCase();
        if (normalized.website) normalized.website = normalized.website.trim().toLowerCase();
        if (normalized.gstin) normalized.gstin = normalized.gstin.trim().toUpperCase();
        if (normalized.pan) normalized.pan = normalized.pan.trim().toUpperCase();

        // Normalize image IDs (ensure they are strings or null)
        if (normalized.companyLogoId === undefined) normalized.companyLogoId = null;
        if (normalized.brandLogoId === undefined) normalized.brandLogoId = null;
        if (normalized.signatureImageId === undefined) normalized.signatureImageId = null;

        // Ensure bankDetails structure
        if (!normalized.bankDetails) {
            normalized.bankDetails = {
                enabled: false,
                bankName: '',
                accountName: '',
                accountNumber: '',
                ifsc: '',
                branch: ''
            };
        } else {
            // Trim bank fields
            if (normalized.bankDetails.bankName) normalized.bankDetails.bankName = normalized.bankDetails.bankName.trim();
            if (normalized.bankDetails.accountName) normalized.bankDetails.accountName = normalized.bankDetails.accountName.trim();
            if (normalized.bankDetails.accountNumber) normalized.bankDetails.accountNumber = normalized.bankDetails.accountNumber.trim();
            if (normalized.bankDetails.ifsc) normalized.bankDetails.ifsc = normalized.bankDetails.ifsc.trim().toUpperCase();
            if (normalized.bankDetails.branch) normalized.bankDetails.branch = normalized.bankDetails.branch.trim();
        }

        // Ensure UPI details structure
        if (!normalized.upiDetails) {
            normalized.upiDetails = {
                enabled: false,
                upiId: '',
                qrImageId: null
            };
        } else {
            if (normalized.upiDetails.upiId) normalized.upiDetails.upiId = normalized.upiDetails.upiId.trim();
        }

        // Ensure authorizedSignatory structure
        if (!normalized.authorizedSignatory) {
            normalized.authorizedSignatory = {
                enabled: false,
                name: '',
                designation: '',
                signatureImageId: null
            };
        } else {
            if (normalized.authorizedSignatory.name) normalized.authorizedSignatory.name = normalized.authorizedSignatory.name.trim();
            if (normalized.authorizedSignatory.designation) normalized.authorizedSignatory.designation = normalized.authorizedSignatory.designation.trim();
        }

        // Trim terms
        if (normalized.invoiceTerms) normalized.invoiceTerms = normalized.invoiceTerms.trim();
        if (normalized.quotationTerms) normalized.quotationTerms = normalized.quotationTerms.trim();
        if (normalized.warrantyTerms) normalized.warrantyTerms = normalized.warrantyTerms.trim();
        if (normalized.paymentTerms) normalized.paymentTerms = normalized.paymentTerms.trim();
        if (normalized.invoiceFooter) normalized.invoiceFooter = normalized.invoiceFooter.trim();
        if (normalized.quotationFooter) normalized.quotationFooter = normalized.quotationFooter.trim();

        return normalized;
    }

    // ============================================================
    // CREATE COMPANY
    // ============================================================

    /**
     * Create a new company profile
     * @param {Object} data - Company data
     * @returns {Promise<Object>} - Created company
     */
    async createCompany(data) {
        await this.initialize();

        // Check if company already exists
        const existing = await database.get(this._storeName, this._companyId);
        if (existing) {
            throw new Error('Company profile already exists. Use updateCompany() to modify.');
        }

        // Validate
        const validation = this.validateCompany(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizeCompany(data);

        // Prepare company object
        const now = new Date().toISOString();
        const company = {
            id: this._companyId,
            companyName: normalized.companyName || '',
            brandName: normalized.brandName || '',
            address: normalized.address || '',
            city: normalized.city || '',
            district: normalized.district || '',
            state: normalized.state || '',
            pincode: normalized.pincode || '',
            phone: normalized.phone || '',
            whatsapp: normalized.whatsapp || '',
            email: normalized.email || '',
            website: normalized.website || '',
            gstin: normalized.gstin || '',
            pan: normalized.pan || '',
            companyLogoId: normalized.companyLogoId || null,
            brandLogoId: normalized.brandLogoId || null,
            signatureImageId: normalized.signatureImageId || null,
            bankDetails: normalized.bankDetails || {
                enabled: false,
                bankName: '',
                accountName: '',
                accountNumber: '',
                ifsc: '',
                branch: ''
            },
            upiDetails: normalized.upiDetails || {
                enabled: false,
                upiId: '',
                qrImageId: null
            },
            authorizedSignatory: normalized.authorizedSignatory || {
                enabled: false,
                name: '',
                designation: '',
                signatureImageId: null
            },
            invoiceTerms: normalized.invoiceTerms || '',
            quotationTerms: normalized.quotationTerms || '',
            warrantyTerms: normalized.warrantyTerms || '',
            paymentTerms: normalized.paymentTerms || '',
            invoiceFooter: normalized.invoiceFooter || '',
            quotationFooter: normalized.quotationFooter || '',
            createdAt: now,
            updatedAt: now
        };

        // Save to database
        await database.add(this._storeName, company);

        // Update cache
        this._cache = company;
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('company', company);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.COMPANY_UPDATED,
            {
                id: company.id,
                companyName: company.companyName,
                action: 'created',
                data: company
            },
            'company-service'
        );

        console.log(`🏢 Company created: ${company.companyName}`);
        return company;
    }

    // ============================================================
    // GET COMPANY
    // ============================================================

    /**
     * Get the current company profile
     * @param {boolean} forceRefresh - Force refresh from database
     * @returns {Promise<Object|null>} - Company or null
     */
    async getCompany(forceRefresh = false) {
        await this.initialize();

        // Check cache
        if (!forceRefresh && this._cache && 
            (Date.now() - this._lastCacheUpdate < this._cacheTimeout)) {
            return { ...this._cache };
        }

        // Get from database
        const company = await database.get(this._storeName, this._companyId);

        // Update cache
        this._cache = company ? { ...company } : null;
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('company', company);
        } catch (error) {
            // State update is optional
        }

        return company ? { ...company } : null;
    }

    /**
     * Check if company profile exists
     * @returns {Promise<boolean>}
     */
    async companyExists() {
        await this.initialize();
        const company = await database.get(this._storeName, this._companyId);
        return !!company;
    }

    // ============================================================
    // UPDATE COMPANY
    // ============================================================

    /**
     * Update the company profile
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated company
     */
    async updateCompany(updates) {
        await this.initialize();

        // Get existing company
        const existing = await database.get(this._storeName, this._companyId);
        if (!existing) {
            throw new Error('Company profile not found. Use createCompany() to create one.');
        }

        // Merge updates with existing
        const merged = { ...existing, ...updates };

        // Validate merged data
        const validation = this.validateCompany(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizeCompany(merged);

        // Preserve ID and timestamps
        const updatedCompany = {
            ...normalized,
            id: this._companyId,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };

        // Save to database
        await database.put(this._storeName, updatedCompany);

        // Update cache
        this._cache = { ...updatedCompany };
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('company', updatedCompany);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.COMPANY_UPDATED,
            {
                id: updatedCompany.id,
                companyName: updatedCompany.companyName,
                action: 'updated',
                data: updatedCompany
            },
            'company-service'
        );

        console.log(`🏢 Company updated: ${updatedCompany.companyName}`);
        return updatedCompany;
    }

    // ============================================================
    // DELETE COMPANY
    // ============================================================

    /**
     * Delete the company profile
     * WARNING: This only deletes the company profile.
     * Other data (customers, products, invoices, etc.) remains intact.
     * @param {string} confirmation - Must be "CONFIRM_DELETE"
     * @returns {Promise<Object>} - Result
     */
    async deleteCompany(confirmation = '') {
        await this.initialize();

        if (confirmation !== 'CONFIRM_DELETE') {
            throw new Error('Company deletion requires confirmation. Call deleteCompany("CONFIRM_DELETE")');
        }

        // Get company before deletion (for event)
        const company = await database.get(this._storeName, this._companyId);
        if (!company) {
            throw new Error('Company profile not found');
        }

        // Delete from database
        await database.delete(this._storeName, this._companyId);

        // Clear cache
        this._cache = null;
        this._lastCacheUpdate = 0;

        // Update state
        try {
            state.set('company', null);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.COMPANY_DELETED,
            {
                id: company.id,
                companyName: company.companyName,
                data: company
            },
            'company-service'
        );

        console.log(`🏢 Company deleted: ${company.companyName}`);
        return { success: true, id: company.id, name: company.companyName };
    }

    // ============================================================
    // COMPANY SNAPSHOT
    // ============================================================

    /**
     * Create a snapshot of the company for invoices/quotations
     * This preserves company data at the time of document creation
     * @param {Object} company - Company object (optional, uses current if not provided)
     * @returns {Promise<Object>} - Company snapshot
     */
    async createCompanySnapshot(company = null) {
        await this.initialize();

        let companyData = company;

        // If no company provided, get current
        if (!companyData) {
            companyData = await this.getCompany(true);
        }

        if (!companyData) {
            throw new Error('Company profile not found');
        }

        // Return snapshot with document-relevant fields
        return {
            companyName: companyData.companyName || '',
            brandName: companyData.brandName || '',
            address: companyData.address || '',
            city: companyData.city || '',
            district: companyData.district || '',
            state: companyData.state || '',
            pincode: companyData.pincode || '',
            phone: companyData.phone || '',
            whatsapp: companyData.whatsapp || '',
            email: companyData.email || '',
            website: companyData.website || '',
            gstin: companyData.gstin || '',
            pan: companyData.pan || '',
            companyLogoId: companyData.companyLogoId || null,
            brandLogoId: companyData.brandLogoId || null,
            signatureImageId: companyData.signatureImageId || null,
            bankDetails: companyData.bankDetails || {
                enabled: false,
                bankName: '',
                accountName: '',
                accountNumber: '',
                ifsc: '',
                branch: ''
            },
            upiDetails: companyData.upiDetails || {
                enabled: false,
                upiId: '',
                qrImageId: null
            },
            authorizedSignatory: companyData.authorizedSignatory || {
                enabled: false,
                name: '',
                designation: '',
                signatureImageId: null
            },
            invoiceTerms: companyData.invoiceTerms || '',
            quotationTerms: companyData.quotationTerms || '',
            warrantyTerms: companyData.warrantyTerms || '',
            paymentTerms: companyData.paymentTerms || '',
            invoiceFooter: companyData.invoiceFooter || '',
            quotationFooter: companyData.quotationFooter || ''
        };
    }

    // ============================================================
    // CONVENIENCE UPDATE METHODS
    // ============================================================

    /**
     * Update company logo reference
     * @param {string} imageId - Image ID from images store
     * @returns {Promise<Object>} - Updated company
     */
    async updateLogoReference(imageId) {
        return this.updateCompany({ companyLogoId: imageId || null });
    }

    /**
     * Update brand logo reference
     * @param {string} imageId - Image ID from images store
     * @returns {Promise<Object>} - Updated company
     */
    async updateBrandLogoReference(imageId) {
        return this.updateCompany({ brandLogoId: imageId || null });
    }

    /**
     * Update signature reference
     * @param {string} imageId - Image ID from images store
     * @returns {Promise<Object>} - Updated company
     */
    async updateSignatureReference(imageId) {
        return this.updateCompany({ signatureImageId: imageId || null });
    }

    /**
     * Update bank details
     * @param {Object} bankDetails - Bank configuration
     * @returns {Promise<Object>} - Updated company
     */
    async updateBankDetails(bankDetails) {
        return this.updateCompany({ bankDetails: bankDetails });
    }

    /**
     * Update UPI details
     * @param {Object} upiDetails - UPI configuration
     * @returns {Promise<Object>} - Updated company
     */
    async updateUpiDetails(upiDetails) {
        return this.updateCompany({ upiDetails: upiDetails });
    }

    /**
     * Update authorized signatory
     * @param {Object} signatory - Signatory configuration
     * @returns {Promise<Object>} - Updated company
     */
    async updateAuthorizedSignatory(signatory) {
        return this.updateCompany({ authorizedSignatory: signatory });
    }

    /**
     * Update invoice terms
     * @param {string} terms - Invoice terms
     * @returns {Promise<Object>} - Updated company
     */
    async updateInvoiceTerms(terms) {
        return this.updateCompany({ invoiceTerms: terms });
    }

    /**
     * Update quotation terms
     * @param {string} terms - Quotation terms
     * @returns {Promise<Object>} - Updated company
     */
    async updateQuotationTerms(terms) {
        return this.updateCompany({ quotationTerms: terms });
    }

    /**
     * Update warranty terms
     * @param {string} terms - Warranty terms
     * @returns {Promise<Object>} - Updated company
     */
    async updateWarrantyTerms(terms) {
        return this.updateCompany({ warrantyTerms: terms });
    }

    /**
     * Update payment terms
     * @param {string} terms - Payment terms
     * @returns {Promise<Object>} - Updated company
     */
    async updatePaymentTerms(terms) {
        return this.updateCompany({ paymentTerms: terms });
    }

    /**
     * Update invoice footer
     * @param {string} footer - Invoice footer
     * @returns {Promise<Object>} - Updated company
     */
    async updateInvoiceFooter(footer) {
        return this.updateCompany({ invoiceFooter: footer });
    }

    /**
     * Update quotation footer
     * @param {string} footer - Quotation footer
     * @returns {Promise<Object>} - Updated company
     */
    async updateQuotationFooter(footer) {
        return this.updateCompany({ quotationFooter: footer });
    }

    // ============================================================
    // COMPANY STATISTICS
    // ============================================================

    /**
     * Get company status
     * @returns {Promise<Object>} - Company status
     */
    async getCompanyStatus() {
        await this.initialize();

        const company = await this.getCompany(true);
        
        if (!company) {
            return {
                exists: false,
                hasLogo: false,
                hasBrandLogo: false,
                hasSignature: false,
                hasBank: false,
                hasUpi: false,
                hasSignatory: false,
                hasTerms: false
            };
        }

        return {
            exists: true,
            hasLogo: !!company.companyLogoId,
            hasBrandLogo: !!company.brandLogoId,
            hasSignature: !!company.signatureImageId,
            hasBank: company.bankDetails && company.bankDetails.enabled,
            hasUpi: company.upiDetails && company.upiDetails.enabled,
            hasSignatory: company.authorizedSignatory && company.authorizedSignatory.enabled,
            hasTerms: !!(company.invoiceTerms || company.quotationTerms || company.warrantyTerms || company.paymentTerms)
        };
    }

    /**
     * Get company info for document header
     * @param {Object} company - Company object (optional)
     * @returns {Promise<Object>} - Company header info
     */
    async getDocumentHeader(company = null) {
        await this.initialize();

        let companyData = company;
        if (!companyData) {
            companyData = await this.getCompany(true);
        }

        if (!companyData) {
            return {
                companyName: '',
                brandName: '',
                address: '',
                city: '',
                district: '',
                state: '',
                pincode: '',
                phone: '',
                email: '',
                gstin: '',
                companyLogoId: null,
                brandLogoId: null
            };
        }

        return {
            companyName: companyData.companyName || '',
            brandName: companyData.brandName || '',
            address: companyData.address || '',
            city: companyData.city || '',
            district: companyData.district || '',
            state: companyData.state || '',
            pincode: companyData.pincode || '',
            phone: companyData.phone || '',
            email: companyData.email || '',
            gstin: companyData.gstin || '',
            companyLogoId: companyData.companyLogoId || null,
            brandLogoId: companyData.brandLogoId || null
        };
    }

    /**
     * Get company info for document footer
     * @param {Object} company - Company object (optional)
     * @returns {Promise<Object>} - Company footer info
     */
    async getDocumentFooter(company = null) {
        await this.initialize();

        let companyData = company;
        if (!companyData) {
            companyData = await this.getCompany(true);
        }

        if (!companyData) {
            return {
                bankDetails: { enabled: false },
                upiDetails: { enabled: false },
                authorizedSignatory: { enabled: false },
                invoiceTerms: '',
                quotationTerms: '',
                warrantyTerms: '',
                paymentTerms: '',
                invoiceFooter: '',
                quotationFooter: ''
            };
        }

        return {
            bankDetails: companyData.bankDetails || { enabled: false },
            upiDetails: companyData.upiDetails || { enabled: false },
            authorizedSignatory: companyData.authorizedSignatory || { enabled: false },
            invoiceTerms: companyData.invoiceTerms || '',
            quotationTerms: companyData.quotationTerms || '',
            warrantyTerms: companyData.warrantyTerms || '',
            paymentTerms: companyData.paymentTerms || '',
            invoiceFooter: companyData.invoiceFooter || '',
            quotationFooter: companyData.quotationFooter || ''
        };
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export company data
     * @returns {Promise<Object>} - Company data
     */
    async exportCompany() {
        await this.initialize();
        const company = await this.getCompany(true);
        if (!company) {
            throw new Error('Company profile not found');
        }
        // Remove internal cache data and return clean copy
        const exportData = { ...company };
        return exportData;
    }

    /**
     * Import company data
     * @param {Object} data - Company data to import
     * @param {boolean} overwrite - Whether to overwrite existing
     * @returns {Promise<Object>} - Imported company
     */
    async importCompany(data, overwrite = false) {
        await this.initialize();

        if (!data || typeof data !== 'object') {
            throw new Error('Invalid company data');
        }

        const exists = await this.companyExists();
        if (exists && !overwrite) {
            throw new Error('Company profile already exists. Use overwrite=true to replace.');
        }

        if (exists && overwrite) {
            // Remove id from data if present to avoid conflict
            const { id, ...importData } = data;
            return this.updateCompany(importData);
        } else {
            return this.createCompany(data);
        }
    }

    /**
     * Refresh cache
     * @returns {Promise<void>}
     */
    async refreshCache() {
        this._cache = null;
        this._lastCacheUpdate = 0;
        await this.getCompany(true);
    }

    /**
     * Clear cache
     */
    clearCache() {
        this._cache = null;
        this._lastCacheUpdate = 0;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const companyService = new CompanyService();

// ============================================================
// EXPORT
// ============================================================

export { companyService };
export default companyService;

// ============================================================
// USAGE EXAMPLES
// ============================================================

/*
// ============================================================
// IMPORTING
// ============================================================

import companyService from './company-service.js';
import { EVENTS } from '../core/events.js';


// ============================================================
// CREATE COMPANY
// ============================================================

const company = await companyService.createCompany({
    companyName: 'AV Chem Chemical & Manufacturing',
    brandName: 'H4 Construction Solutions',
    address: '123 Industrial Area',
    city: 'Tirur',
    district: 'Malappuram',
    state: 'Kerala',
    pincode: '676101',
    phone: '9876543210',
    whatsapp: '9876543210',
    email: 'info@h4.in',
    website: 'https://h4.in',
    gstin: '32AAAAA0000A1Z5'
});


// ============================================================
// GET COMPANY
// ============================================================

const company = await companyService.getCompany();
console.log('Company:', company.companyName);


// ============================================================
// UPDATE COMPANY
// ============================================================

const updated = await companyService.updateCompany({
    phone: '9876543211',
    address: '456 New Road, Tirur'
});


// ============================================================
// UPDATE BANK DETAILS
// ============================================================

await companyService.updateBankDetails({
    enabled: true,
    bankName: 'State Bank of India',
    accountName: 'AV Chem Chemical & Manufacturing',
    accountNumber: '1234567890',
    ifsc: 'SBIN0001234',
    branch: 'Tirur'
});


// ============================================================
// UPDATE UPI DETAILS
// ============================================================

await companyService.updateUpiDetails({
    enabled: true,
    upiId: 'h4@upi',
    qrImageId: 'IMG-UPI-001'
});


// ============================================================
// UPDATE INVOICE TERMS
// ============================================================

await companyService.updateInvoiceTerms(
    'Payment due within 15 days. Late payment interest @ 18% p.a.'
);


// ============================================================
// CREATE SNAPSHOT (for invoice/quotation)
// ============================================================

const snapshot = await companyService.createCompanySnapshot();

// Use snapshot in invoice:
const invoice = {
    companySnapshot: snapshot,
    // ... other invoice data
};


// ============================================================
// GET DOCUMENT HEADER
// ============================================================

const header = await companyService.getDocumentHeader();
console.log('Company header:', header);


// ============================================================
// GET DOCUMENT FOOTER
// ============================================================

const footer = await companyService.getDocumentFooter();
console.log('Company footer:', footer);


// ============================================================
// DELETE COMPANY
// ============================================================

await companyService.deleteCompany('CONFIRM_DELETE');


// ============================================================
// LISTEN FOR COMPANY EVENTS
// ============================================================

eventBus.on(EVENTS.COMPANY_UPDATED, (payload) => {
    console.log('Company updated:', payload.payload.companyName);
    refreshCompanyDisplay();
});

eventBus.on(EVENTS.COMPANY_DELETED, (payload) => {
    console.log('Company deleted:', payload.payload.companyName);
    refreshCompanyDisplay();
});
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → company store
// EVENTS: COMPANY_UPDATED, COMPANY_DELETED
// 
// DATA MODEL:
// id, companyName, brandName, address, city, district,
// state, pincode, phone, whatsapp, email, website,
// gstin, pan, companyLogoId, brandLogoId, signatureImageId,
// bankDetails, upiDetails, authorizedSignatory,
// invoiceTerms, quotationTerms, warrantyTerms, paymentTerms,
// invoiceFooter, quotationFooter, createdAt, updatedAt
// 
// FUNCTIONS: 22
// 
// DATA PROTECTION:
// - Historical invoice/quotation data preserved via snapshots
// - Only company profile is affected
// - Other stores (customers, products, etc.) remain intact
// 
// ============================================================