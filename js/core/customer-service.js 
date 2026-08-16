/**
 * H4 Billing ERP - Customer Service Module
 * Central service for all customer-related operations
 * Version: 1.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * customer-service.js provides a clean API for customer CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: customers
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.CUSTOMER_ADDED
 * - EVENTS.CUSTOMER_UPDATED
 * - EVENTS.CUSTOMER_DELETED
 * 
 * ============================================================
 * DEPENDENCIES
 * ============================================================
 * 
 * - database.js (central database)
 * - events.js (event bus)
 * - state.js (application state - optional)
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
 * - Does NOT emit events before successful DB operation
 * - Does NOT delete historical invoice/quotation data
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

const STORE_NAME = 'customers';

const VALID_CUSTOMER_TYPES = [
    'Retail',
    'Dealer',
    'Contractor',
    'Builder',
    'Company',
    'Architect',
    'Engineer',
    'Mason',
    'Other'
];

// ============================================================
// CUSTOMER SERVICE CLASS
// ============================================================

class CustomerService {
    constructor() {
        this._storeName = STORE_NAME;
        this._initialized = false;
    }

    /**
     * Initialize the service
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialized) return;
        await database.open();
        this._initialized = true;
        console.log('👤 Customer service initialized');
    }

    // ============================================================
    // GENERATE CUSTOMER ID
    // ============================================================

    /**
     * Generate a customer ID
     * Uses existing database.generateId() if available
     * @returns {string} - Customer ID
     */
    _generateCustomerId() {
        // Use database's generateId if available
        if (database.generateId && typeof database.generateId === 'function') {
            return database.generateId();
        }
        // Fallback: Use crypto.randomUUID()
        return crypto.randomUUID();
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate customer data
     * @param {Object} data - Customer data to validate
     * @returns {Object} - { valid: boolean, errors: Array<string> }
     */
    validateCustomer(data) {
        const errors = [];

        // Name is required
        if (!data.name || data.name.trim() === '') {
            errors.push('Customer name is required');
        }

        // Customer type must be valid
        if (data.customerType && !VALID_CUSTOMER_TYPES.includes(data.customerType)) {
            errors.push(`Invalid customer type: ${data.customerType}. Valid types: ${VALID_CUSTOMER_TYPES.join(', ')}`);
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

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // NORMALIZATION
    // ============================================================

    /**
     * Normalize customer data before saving
     * @param {Object} data - Customer data to normalize
     * @returns {Object} - Normalized customer data
     */
    normalizeCustomer(data) {
        const normalized = { ...data };

        // Trim string fields
        if (normalized.name) normalized.name = normalized.name.trim();
        if (normalized.address) normalized.address = normalized.address.trim();
        if (normalized.city) normalized.city = normalized.city.trim();
        if (normalized.state) normalized.state = normalized.state.trim();
        if (normalized.pincode) normalized.pincode = normalized.pincode.trim();
        if (normalized.phone) normalized.phone = normalized.phone.trim();
        if (normalized.whatsapp) normalized.whatsapp = normalized.whatsapp.trim();
        if (normalized.email) normalized.email = normalized.email.trim().toLowerCase();
        if (normalized.gstin) normalized.gstin = normalized.gstin.trim().toUpperCase();
        if (normalized.pan) normalized.pan = normalized.pan.trim().toUpperCase();
        if (normalized.notes) normalized.notes = normalized.notes.trim();

        // Set default customer type if not provided
        if (!normalized.customerType) {
            normalized.customerType = 'Retail';
        }

        // Set default active status
        if (normalized.active === undefined || normalized.active === null) {
            normalized.active = true;
        }

        return normalized;
    }

    // ============================================================
    // CREATE CUSTOMER
    // ============================================================

    /**
     * Create a new customer
     * @param {Object} data - Customer data
     * @returns {Promise<Object>} - Created customer
     */
    async createCustomer(data) {
        await this.initialize();

        // Validate
        const validation = this.validateCustomer(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizeCustomer(data);

        // Check for duplicates
        const duplicate = await this.findDuplicateCustomer(normalized);
        if (duplicate) {
            console.warn('⚠️ Potential duplicate customer found:', duplicate.name);
        }

        // Generate ID
        const id = this._generateCustomerId();

        // Prepare customer object
        const now = new Date().toISOString();
        const customer = {
            id: id,
            name: normalized.name,
            customerType: normalized.customerType,
            phone: normalized.phone || '',
            whatsapp: normalized.whatsapp || '',
            email: normalized.email || '',
            address: normalized.address || '',
            city: normalized.city || '',
            state: normalized.state || '',
            pincode: normalized.pincode || '',
            gstin: normalized.gstin || '',
            pan: normalized.pan || '',
            notes: normalized.notes || '',
            active: normalized.active !== false,
            createdAt: now,
            updatedAt: now
        };

        // Save to database
        await database.add(this._storeName, customer);

        // Update state (if state.js is available and has customer state)
        try {
            const customers = await database.getAll(this._storeName);
            state.set('customers', customers);
            state.set('selectedCustomer', customer);
        } catch (error) {
            // State update is optional - don't fail if state is not available
        }

        // Emit event
        await eventBus.emit(
            EVENTS.CUSTOMER_ADDED,
            {
                id: customer.id,
                name: customer.name,
                data: customer
            },
            'customer-service'
        );

        console.log(`👤 Customer created: ${customer.name} (${customer.id})`);
        return customer;
    }

    // ============================================================
    // GET CUSTOMER
    // ============================================================

    /**
     * Get a customer by ID
     * @param {string} id - Customer ID
     * @returns {Promise<Object|null>} - Customer or null
     */
    async getCustomer(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    // ============================================================
    // GET ALL CUSTOMERS
    // ============================================================

    /**
     * Get all customers with options
     * @param {Object} options - Query options
     * @param {boolean} options.activeOnly - Only return active customers
     * @param {string} options.sortBy - Field to sort by
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @param {number} options.limit - Maximum number of results
     * @param {number} options.offset - Number of results to skip
     * @returns {Promise<Array>} - Array of customers
     */
    async getCustomers(options = {}) {
        await this.initialize();

        let customers = await database.getAll(this._storeName);

        // Filter active only
        if (options.activeOnly) {
            customers = customers.filter(c => c.active !== false);
        }

        // Sort
        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            customers.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        }

        // Pagination
        if (options.limit) {
            const offset = options.offset || 0;
            customers = customers.slice(offset, offset + options.limit);
        }

        return customers;
    }

    // ============================================================
    // UPDATE CUSTOMER
    // ============================================================

    /**
     * Update an existing customer
     * @param {string} id - Customer ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated customer
     */
    async updateCustomer(id, updates) {
        await this.initialize();

        // Get existing customer
        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Customer not found: ${id}`);
        }

        // Merge updates with existing
        const merged = { ...existing, ...updates };

        // Validate merged data
        const validation = this.validateCustomer(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizeCustomer(merged);

        // Preserve ID and timestamps
        const updatedCustomer = {
            ...normalized,
            id: id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };

        // Save to database
        await database.put(this._storeName, updatedCustomer);

        // Update state
        try {
            const customers = await database.getAll(this._storeName);
            state.set('customers', customers);
            state.set('selectedCustomer', updatedCustomer);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.CUSTOMER_UPDATED,
            {
                id: updatedCustomer.id,
                name: updatedCustomer.name,
                data: updatedCustomer
            },
            'customer-service'
        );

        console.log(`👤 Customer updated: ${updatedCustomer.name} (${updatedCustomer.id})`);
        return updatedCustomer;
    }

    // ============================================================
    // DELETE CUSTOMER
    // ============================================================

    /**
     * Delete a customer
     * IMPORTANT: Historical invoices/quotations remain intact
     * because they store customerSnapshot
     * @param {string} id - Customer ID
     * @returns {Promise<Object>} - Result
     */
    async deleteCustomer(id) {
        await this.initialize();

        // Get customer before deletion (for event)
        const customer = await database.get(this._storeName, id);
        if (!customer) {
            throw new Error(`Customer not found: ${id}`);
        }

        // Delete from database
        await database.delete(this._storeName, id);

        // Update state
        try {
            const customers = await database.getAll(this._storeName);
            state.set('customers', customers);
            if (state.get('selectedCustomer')?.id === id) {
                state.set('selectedCustomer', null);
            }
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.CUSTOMER_DELETED,
            {
                id: customer.id,
                name: customer.name,
                data: customer
            },
            'customer-service'
        );

        console.log(`👤 Customer deleted: ${customer.name} (${customer.id})`);
        return { success: true, id: id, name: customer.name };
    }

    // ============================================================
    // SEARCH CUSTOMERS
    // ============================================================

    /**
     * Search customers by multiple fields
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @param {boolean} options.activeOnly - Only search active customers
     * @param {number} options.limit - Maximum results
     * @returns {Promise<Array>} - Matching customers
     */
    async searchCustomers(query, options = {}) {
        await this.initialize();

        if (!query || query.trim() === '') {
            return this.getCustomers({ activeOnly: options.activeOnly, limit: options.limit });
        }

        const term = query.toLowerCase().trim();
        let customers = await database.getAll(this._storeName);

        // Filter active only
        if (options.activeOnly) {
            customers = customers.filter(c => c.active !== false);
        }

        // Search in fields
        const results = customers.filter(customer => {
            const searchableFields = [
                customer.name,
                customer.phone,
                customer.whatsapp,
                customer.email,
                customer.gstin,
                customer.pan,
                customer.id,
                customer.customerType
            ];

            return searchableFields.some(field => {
                if (!field) return false;
                return String(field).toLowerCase().includes(term);
            });
        });

        // Limit results
        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    // ============================================================
    // FIND DUPLICATE CUSTOMER
    // ============================================================

    /**
     * Find potential duplicate customers
     * @param {Object} data - Customer data to check
     * @returns {Promise<Object|null>} - Duplicate customer or null
     */
    async findDuplicateCustomer(data) {
        await this.initialize();

        const customers = await database.getAll(this._storeName);

        // Check by phone
        if (data.phone) {
            const duplicate = customers.find(c =>
                c.phone === data.phone && c.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        // Check by email
        if (data.email) {
            const duplicate = customers.find(c =>
                c.email && c.email.toLowerCase() === data.email.toLowerCase() &&
                c.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        // Check by GSTIN
        if (data.gstin) {
            const duplicate = customers.find(c =>
                c.gstin && c.gstin.toUpperCase() === data.gstin.toUpperCase() &&
                c.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        return null;
    }

    // ============================================================
    // CREATE CUSTOMER SNAPSHOT
    // ============================================================

    /**
     * Create a snapshot of a customer for invoices/quotations
     * This preserves customer data at the time of document creation
     * @param {Object|string} customer - Customer object or ID
     * @returns {Promise<Object>} - Customer snapshot
     */
    async createCustomerSnapshot(customer) {
        await this.initialize();

        let customerData = customer;

        // If ID is provided, fetch the customer
        if (typeof customer === 'string') {
            customerData = await database.get(this._storeName, customer);
            if (!customerData) {
                throw new Error(`Customer not found: ${customer}`);
            }
        }

        // Return snapshot with document-relevant fields
        return {
            id: customerData.id,
            name: customerData.name || '',
            customerType: customerData.customerType || '',
            phone: customerData.phone || '',
            whatsapp: customerData.whatsapp || '',
            email: customerData.email || '',
            address: customerData.address || '',
            city: customerData.city || '',
            state: customerData.state || '',
            pincode: customerData.pincode || '',
            gstin: customerData.gstin || '',
            pan: customerData.pan || ''
        };
    }

    // ============================================================
    // SET CUSTOMER ACTIVE STATUS
    // ============================================================

    /**
     * Set customer active status
     * @param {string} id - Customer ID
     * @param {boolean} active - Active status
     * @returns {Promise<Object>} - Updated customer
     */
    async setCustomerActive(id, active) {
        await this.initialize();

        const customer = await database.get(this._storeName, id);
        if (!customer) {
            throw new Error(`Customer not found: ${id}`);
        }

        return this.updateCustomer(id, { active: active });
    }

    // ============================================================
    // CUSTOMER STATISTICS
    // ============================================================

    /**
     * Get customer statistics
     * @returns {Promise<Object>} - Customer statistics
     */
    async getCustomerStats() {
        await this.initialize();

        const customers = await database.getAll(this._storeName);
        const total = customers.length;
        const active = customers.filter(c => c.active !== false).length;
        const inactive = total - active;

        // Count by type
        const byType = {};
        for (const customer of customers) {
            const type = customer.customerType || 'Other';
            byType[type] = (byType[type] || 0) + 1;
        }

        return {
            total: total,
            active: active,
            inactive: inactive,
            byType: byType,
            hasGstin: customers.filter(c => c.gstin && c.gstin.trim() !== '').length,
            hasPan: customers.filter(c => c.pan && c.pan.trim() !== '').length
        };
    }

    /**
     * Count total customers
     * @returns {Promise<number>}
     */
    async countCustomers() {
        await this.initialize();
        return database.count(this._storeName);
    }

    /**
     * Count active customers
     * @returns {Promise<number>}
     */
    async countActiveCustomers() {
        await this.initialize();
        const customers = await database.getAll(this._storeName);
        return customers.filter(c => c.active !== false).length;
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Bulk delete customers
     * @param {Array<string>} ids - Customer IDs to delete
     * @returns {Promise<Object>} - Results
     */
    async bulkDeleteCustomers(ids) {
        await this.initialize();

        const results = {
            success: [],
            failed: []
        };

        for (const id of ids) {
            try {
                await this.deleteCustomer(id);
                results.success.push(id);
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }

        return results;
    }

    /**
     * Bulk set active status
     * @param {Array<string>} ids - Customer IDs
     * @param {boolean} active - Active status
     * @returns {Promise<Object>} - Results
     */
    async bulkSetActive(ids, active) {
        await this.initialize();

        const results = {
            success: [],
            failed: []
        };

        for (const id of ids) {
            try {
                await this.setCustomerActive(id, active);
                results.success.push(id);
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }

        return results;
    }

    // ============================================================
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export customers to CSV
     * @param {Array} customers - Customers to export
     * @returns {string} - CSV string
     */
    exportToCSV(customers) {
        const headers = ['ID', 'Name', 'Type', 'Phone', 'WhatsApp', 'Email', 'GSTIN', 'PAN', 'Address', 'City', 'State', 'Active', 'Created At'];
        const rows = customers.map(c => [
            c.id,
            c.name || '',
            c.customerType || '',
            c.phone || '',
            c.whatsapp || '',
            c.email || '',
            c.gstin || '',
            c.pan || '',
            c.address || '',
            c.city || '',
            c.state || '',
            c.active !== false ? 'Yes' : 'No',
            c.createdAt || ''
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Import customers from CSV
     * @param {string} csv - CSV string
     * @returns {Promise<Array>} - Imported customer IDs
     */
    async importFromCSV(csv) {
        await this.initialize();

        const lines = csv.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV must contain headers and at least one row');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const importedIds = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const customer = {};

            for (let j = 0; j < headers.length; j++) {
                const key = headers[j];
                const value = values[j] || '';

                // Map CSV headers to customer fields
                if (key === 'Name') customer.name = value;
                else if (key === 'Type') customer.customerType = value;
                else if (key === 'Phone') customer.phone = value;
                else if (key === 'WhatsApp') customer.whatsapp = value;
                else if (key === 'Email') customer.email = value;
                else if (key === 'GSTIN') customer.gstin = value;
                else if (key === 'PAN') customer.pan = value;
                else if (key === 'Address') customer.address = value;
                else if (key === 'City') customer.city = value;
                else if (key === 'State') customer.state = value;
                else if (key === 'Active') customer.active = value !== 'No';
            }

            // Skip empty rows
            if (!customer.name) continue;

            try {
                const created = await this.createCustomer(customer);
                importedIds.push(created.id);
            } catch (error) {
                console.warn(`Failed to import customer ${customer.name}:`, error);
            }
        }

        return importedIds;
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const customerService = new CustomerService();

// ============================================================
// EXPORT
// ============================================================

export { customerService };
export default customerService;

// ============================================================
// USAGE EXAMPLES
// ============================================================

/*
// ============================================================
// IMPORTING
// ============================================================

import customerService from './customer-service.js';
import { EVENTS } from '../core/events.js';


// ============================================================
// CREATE CUSTOMER
// ============================================================

const customer = await customerService.createCustomer({
    name: 'ABC Builders',
    customerType: 'Builder',
    phone: '9876543210',
    email: 'abc@builders.com',
    gstin: '22AAAAA0000A1Z5',
    address: '123 Main Road, Tirur'
});

console.log('Created customer:', customer);


// ============================================================
// GET CUSTOMER
// ============================================================

const existing = await customerService.getCustomer(customer.id);
console.log('Customer:', existing);


// ============================================================
// GET ALL CUSTOMERS
// ============================================================

const allCustomers = await customerService.getCustomers({
    activeOnly: true,
    sortBy: 'name',
    sortDirection: 'asc'
});


// ============================================================
// SEARCH CUSTOMERS
// ============================================================

const results = await customerService.searchCustomers('ABC', {
    activeOnly: true,
    limit: 10
});


// ============================================================
// UPDATE CUSTOMER
// ============================================================

const updated = await customerService.updateCustomer(customer.id, {
    phone: '9876543211',
    address: '456 New Road, Tirur'
});


// ============================================================
// DELETE CUSTOMER
// ============================================================

await customerService.deleteCustomer(customer.id);


// ============================================================
// CREATE SNAPSHOT (for invoice/quotation)
// ============================================================

const snapshot = await customerService.createCustomerSnapshot(customer.id);

// Use snapshot in invoice:
const invoice = {
    customerId: customer.id,
    customerSnapshot: snapshot,
    // ... other invoice data
};


// ============================================================
// LISTEN FOR CUSTOMER EVENTS
// ============================================================

eventBus.on(EVENTS.CUSTOMER_ADDED, (payload) => {
    console.log('New customer:', payload.payload.name);
    refreshCustomerDropdown();
});

eventBus.on(EVENTS.CUSTOMER_UPDATED, (payload) => {
    console.log('Customer updated:', payload.payload.name);
    refreshCustomerList();
});

eventBus.on(EVENTS.CUSTOMER_DELETED, (payload) => {
    console.log('Customer deleted:', payload.payload.name);
    refreshCustomerList();
});
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → customers store
// EVENTS: CUSTOMER_ADDED, CUSTOMER_UPDATED, CUSTOMER_DELETED
// 
// FUNCTIONS:
// - createCustomer() - Create new customer
// - getCustomer() - Get customer by ID
// - getCustomers() - Get all customers with options
// - updateCustomer() - Update existing customer
// - deleteCustomer() - Delete customer (preserves historical data)
// - searchCustomers() - Search customers
// - findDuplicateCustomer() - Check for duplicates
// - validateCustomer() - Validate customer data
// - normalizeCustomer() - Normalize customer data
// - createCustomerSnapshot() - Create snapshot for documents
// - setCustomerActive() - Toggle active status
// - countCustomers() / countActiveCustomers() - Statistics
// - bulkDeleteCustomers() / bulkSetActive() - Bulk operations
// - exportToCSV() / importFromCSV() - Export/Import
// 
// DATA PROTECTION:
// - Historical invoice/quotation data preserved via snapshots
// - Only requested customer is deleted
// - No accidental mass deletion
// 
// ============================================================