/**
 * H4 Billing ERP - Product Service Module
 * Central service for all product-related operations
 * Version: 2.0.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * product-service.js provides a clean API for product CRUD
 * operations using the central H4BillingERP database.
 * 
 * ============================================================
 * DATABASE
 * ============================================================
 * 
 * Database: H4BillingERP
 * Store: products
 * 
 * Categories and Units are persisted in the settings store.
 * 
 * ============================================================
 * EVENTS
 * ============================================================
 * 
 * Emits:
 * - EVENTS.PRODUCT_ADDED
 * - EVENTS.PRODUCT_UPDATED
 * - EVENTS.PRODUCT_DELETED
 * - EVENTS.SETTINGS_UPDATED (when categories/units change)
 * 
 * ============================================================
 * PRODUCT DATA MODEL (UPDATED)
 * ============================================================
 * 
 * id              - Unique product ID
 * code            - Product code (e.g., H4-TA-C1)
 * name            - Product name
 * category        - Product category
 * brand           - Brand name
 * description     - Product description
 * unit            - Unit of measurement
 * hsn             - HSN/SAC code
 * gstRate         - GST rate (%)
 * sellingRate     - Default selling rate
 * purchaseCost    - Purchase cost
 * dealerPrice     - Dealer price
 * contractorPrice - Contractor price
 * mrp             - Maximum Retail Price
 * image           - Product image (base64)
 * openingStock    - Opening stock quantity
 * currentStock    - Current stock quantity
 * minStock        - Minimum stock alert level
 * status          - 'active' or 'inactive'
 * createdAt       - Creation timestamp
 * updatedAt       - Last update timestamp
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
 * - Does NOT add taxMode to Product Master
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

const STORE_NAME = 'products';
const SETTINGS_STORE_NAME = 'settings';
const SETTINGS_ID = 'settings';

// Default categories - used only when settings don't exist
const DEFAULT_CATEGORIES = [
    'Tile Adhesive',
    'Waterproofing',
    'Epoxy Flooring',
    'General Products',
    'Services'
];

// Default units - used only when settings don't exist
const DEFAULT_UNITS = [
    'Nos',
    'Bag',
    'Kg',
    'Gram',
    'Litre',
    'ML',
    'Meter',
    'Sq.ft',
    'Sq.m',
    'Box',
    'Set',
    'Piece',
    'Hour',
    'Day',
    'Trip',
    'Job'
];

// ============================================================
// PRODUCT SERVICE CLASS
// ============================================================

class ProductService {
    constructor() {
        this._storeName = STORE_NAME;
        this._settingsStoreName = SETTINGS_STORE_NAME;
        this._settingsId = SETTINGS_ID;
        this._initialized = false;
        this._categoriesCache = null;
        this._unitsCache = null;
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
        console.log('📦 Product service initialized');
    }

    // ============================================================
    // CATEGORY MANAGEMENT (PERSISTENT)
    // ============================================================

    /**
     * Get all categories from settings
     * @param {boolean} forceRefresh - Force refresh from database
     * @returns {Promise<Array<string>>}
     */
    async getCategories(forceRefresh = false) {
        await this.initialize();

        // Check cache
        if (!forceRefresh && this._categoriesCache && 
            (Date.now() - this._lastCacheUpdate < this._cacheTimeout)) {
            return [...this._categoriesCache];
        }

        // Get settings
        const settings = await database.get(this._settingsStoreName, this._settingsId);
        
        let categories;
        if (settings && settings.productCategories && Array.isArray(settings.productCategories)) {
            categories = settings.productCategories;
        } else {
            // If settings don't exist or don't have categories, use defaults
            categories = [...DEFAULT_CATEGORIES];
            // Save defaults to settings
            await this._saveCategories(categories);
        }

        // Update cache
        this._categoriesCache = [...categories];
        this._lastCacheUpdate = Date.now();

        return [...categories];
    }

    /**
     * Add a new category
     * @param {string} category - New category name
     * @returns {Promise<Array<string>>} - Updated categories
     */
    async addCategory(category) {
        await this.initialize();

        if (!category || category.trim() === '') {
            throw new Error('Category name is required');
        }

        const trimmed = category.trim();
        const currentCategories = await this.getCategories(true);
        
        const duplicate = currentCategories.find(
            c => c.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (duplicate) {
            throw new Error(`Category "${trimmed}" already exists`);
        }

        const updatedCategories = [...currentCategories, trimmed];
        await this._saveCategories(updatedCategories);

        this._categoriesCache = [...updatedCategories];
        this._lastCacheUpdate = Date.now();

        try {
            state.set('productCategories', updatedCategories);
        } catch (error) {
            // State update is optional
        }

        await eventBus.emit(
            EVENTS.SETTINGS_UPDATED,
            {
                type: 'product-category-added',
                value: trimmed,
                categories: updatedCategories
            },
            'product-service'
        );

        console.log(`📂 Category added: ${trimmed}`);
        return updatedCategories;
    }

    /**
     * Remove a category
     * @param {string} category - Category to remove
     * @returns {Promise<Array<string>>} - Updated categories
     */
    async removeCategory(category) {
        await this.initialize();

        if (!category || category.trim() === '') {
            throw new Error('Category name is required');
        }

        const trimmed = category.trim();
        const currentCategories = await this.getCategories(true);
        
        const exists = currentCategories.find(
            c => c.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (!exists) {
            throw new Error(`Category "${trimmed}" not found`);
        }

        // Don't allow removing if products are using this category
        const products = await this.getProducts({ activeOnly: false });
        const productsUsingCategory = products.filter(p => p.category === trimmed);
        if (productsUsingCategory.length > 0) {
            throw new Error(
                `Cannot remove category "${trimmed}" because it is used by ${productsUsingCategory.length} product(s)`
            );
        }

        const updatedCategories = currentCategories.filter(
            c => c.toLowerCase() !== trimmed.toLowerCase()
        );
        await this._saveCategories(updatedCategories);

        this._categoriesCache = [...updatedCategories];
        this._lastCacheUpdate = Date.now();

        try {
            state.set('productCategories', updatedCategories);
        } catch (error) {
            // State update is optional
        }

        await eventBus.emit(
            EVENTS.SETTINGS_UPDATED,
            {
                type: 'product-category-removed',
                value: trimmed,
                categories: updatedCategories
            },
            'product-service'
        );

        console.log(`📂 Category removed: ${trimmed}`);
        return updatedCategories;
    }

    /**
     * Save categories to settings
     * @param {Array<string>} categories - Categories to save
     * @returns {Promise<void>}
     */
    async _saveCategories(categories) {
        let settings = await database.get(this._settingsStoreName, this._settingsId);
        
        if (!settings) {
            settings = {
                id: this._settingsId,
                productCategories: categories,
                productUnits: DEFAULT_UNITS,
                updatedAt: new Date().toISOString()
            };
            await database.add(this._settingsStoreName, settings);
        } else {
            settings.productCategories = categories;
            settings.updatedAt = new Date().toISOString();
            await database.put(this._settingsStoreName, settings);
        }
    }

    // ============================================================
    // UNIT MANAGEMENT (PERSISTENT)
    // ============================================================

    /**
     * Get all units from settings
     * @param {boolean} forceRefresh - Force refresh from database
     * @returns {Promise<Array<string>>}
     */
    async getUnits(forceRefresh = false) {
        await this.initialize();

        if (!forceRefresh && this._unitsCache && 
            (Date.now() - this._lastCacheUpdate < this._cacheTimeout)) {
            return [...this._unitsCache];
        }

        const settings = await database.get(this._settingsStoreName, this._settingsId);
        
        let units;
        if (settings && settings.productUnits && Array.isArray(settings.productUnits)) {
            units = settings.productUnits;
        } else {
            units = [...DEFAULT_UNITS];
            await this._saveUnits(units);
        }

        this._unitsCache = [...units];
        this._lastCacheUpdate = Date.now();

        return [...units];
    }

    /**
     * Add a new unit
     * @param {string} unit - New unit name
     * @returns {Promise<Array<string>>} - Updated units
     */
    async addUnit(unit) {
        await this.initialize();

        if (!unit || unit.trim() === '') {
            throw new Error('Unit name is required');
        }

        const trimmed = unit.trim();
        const currentUnits = await this.getUnits(true);
        
        const duplicate = currentUnits.find(
            u => u.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (duplicate) {
            throw new Error(`Unit "${trimmed}" already exists`);
        }

        const updatedUnits = [...currentUnits, trimmed];
        await this._saveUnits(updatedUnits);

        this._unitsCache = [...updatedUnits];
        this._lastCacheUpdate = Date.now();

        try {
            state.set('productUnits', updatedUnits);
        } catch (error) {
            // State update is optional
        }

        await eventBus.emit(
            EVENTS.SETTINGS_UPDATED,
            {
                type: 'product-unit-added',
                value: trimmed,
                units: updatedUnits
            },
            'product-service'
        );

        console.log(`📏 Unit added: ${trimmed}`);
        return updatedUnits;
    }

    /**
     * Remove a unit
     * @param {string} unit - Unit to remove
     * @returns {Promise<Array<string>>} - Updated units
     */
    async removeUnit(unit) {
        await this.initialize();

        if (!unit || unit.trim() === '') {
            throw new Error('Unit name is required');
        }

        const trimmed = unit.trim();
        const currentUnits = await this.getUnits(true);
        
        const exists = currentUnits.find(
            u => u.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (!exists) {
            throw new Error(`Unit "${trimmed}" not found`);
        }

        const products = await this.getProducts({ activeOnly: false });
        const productsUsingUnit = products.filter(p => p.unit === trimmed);
        if (productsUsingUnit.length > 0) {
            throw new Error(
                `Cannot remove unit "${trimmed}" because it is used by ${productsUsingUnit.length} product(s)`
            );
        }

        const updatedUnits = currentUnits.filter(
            u => u.toLowerCase() !== trimmed.toLowerCase()
        );
        await this._saveUnits(updatedUnits);

        this._unitsCache = [...updatedUnits];
        this._lastCacheUpdate = Date.now();

        try {
            state.set('productUnits', updatedUnits);
        } catch (error) {
            // State update is optional
        }

        await eventBus.emit(
            EVENTS.SETTINGS_UPDATED,
            {
                type: 'product-unit-removed',
                value: trimmed,
                units: updatedUnits
            },
            'product-service'
        );

        console.log(`📏 Unit removed: ${trimmed}`);
        return updatedUnits;
    }

    /**
     * Save units to settings
     * @param {Array<string>} units - Units to save
     * @returns {Promise<void>}
     */
    async _saveUnits(units) {
        let settings = await database.get(this._settingsStoreName, this._settingsId);
        
        if (!settings) {
            settings = {
                id: this._settingsId,
                productCategories: DEFAULT_CATEGORIES,
                productUnits: units,
                updatedAt: new Date().toISOString()
            };
            await database.add(this._settingsStoreName, settings);
        } else {
            settings.productUnits = units;
            settings.updatedAt = new Date().toISOString();
            await database.put(this._settingsStoreName, settings);
        }
    }

    /**
     * Refresh category and unit cache
     * @returns {Promise<void>}
     */
    async refreshCache() {
        this._categoriesCache = null;
        this._unitsCache = null;
        this._lastCacheUpdate = 0;
        await this.getCategories(true);
        await this.getUnits(true);
    }

    // ============================================================
    // GENERATE PRODUCT ID / CODE
    // ============================================================

    /**
     * Generate a product ID
     * @returns {string} - Product ID
     */
    _generateProductId() {
        if (database.generateId && typeof database.generateId === 'function') {
            return database.generateId();
        }
        return 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    }

    /**
     * Generate a product code if not provided
     * @param {string} name - Product name
     * @param {string} category - Product category
     * @param {Array} existingProducts - Existing products to avoid duplicates
     * @returns {string} - Generated product code
     */
    _generateProductCode(name, category, existingProducts) {
        const prefix = category ? category.substring(0, 3).toUpperCase() : 'PRD';
        const namePart = name ? name.substring(0, 5).toUpperCase() : 'PROD';
        
        // Get existing codes
        const existingCodes = existingProducts.map(p => p.code || '');
        let counter = 1;
        let newCode;
        
        do {
            newCode = `${prefix}-${namePart}-${String(counter).padStart(2, '0')}`;
            counter++;
        } while (existingCodes.includes(newCode));
        
        return newCode;
    }

    // ============================================================
    // VALIDATION (UPDATED)
    // ============================================================

    /**
     * Validate product data
     * @param {Object} data - Product data to validate
     * @returns {Promise<Object>} - { valid: boolean, errors: Array<string> }
     */
    async validateProduct(data) {
        const errors = [];

        // Name is required
        if (!data.name || data.name.trim() === '') {
            errors.push('Product name is required');
        }

        // Unit is required
        if (!data.unit || data.unit.trim() === '') {
            errors.push('Unit is required');
        } else {
            const units = await this.getUnits();
            if (!units.includes(data.unit)) {
                errors.push(`Invalid unit: ${data.unit}. Valid units: ${units.join(', ')}`);
            }
        }

        // Category validation
        if (data.category) {
            const categories = await this.getCategories();
            if (!categories.includes(data.category)) {
                errors.push(`Invalid category: ${data.category}. Valid categories: ${categories.join(', ')}`);
            }
        }

        // Selling rate is required
        if (data.sellingRate === undefined || data.sellingRate === null || data.sellingRate < 0) {
            errors.push('Selling rate is required and must be a positive number');
        }

        // GST rate validation
        if (data.gstRate !== undefined && data.gstRate !== null) {
            if (isNaN(data.gstRate) || data.gstRate < 0 || data.gstRate > 100) {
                errors.push('GST rate must be between 0 and 100');
            }
        }

        // Other numeric validations
        const numericFields = ['purchaseCost', 'dealerPrice', 'contractorPrice', 'mrp'];
        for (const field of numericFields) {
            if (data[field] !== undefined && data[field] !== null) {
                if (isNaN(data[field]) || data[field] < 0) {
                    errors.push(`${field} must be a positive number`);
                }
            }
        }

        // Stock validations
        if (data.openingStock !== undefined && data.openingStock !== null) {
            if (isNaN(data.openingStock) || data.openingStock < 0) {
                errors.push('Opening stock must be a positive number');
            }
        }
        if (data.currentStock !== undefined && data.currentStock !== null) {
            if (isNaN(data.currentStock) || data.currentStock < 0) {
                errors.push('Current stock must be a positive number');
            }
        }
        if (data.minStock !== undefined && data.minStock !== null) {
            if (isNaN(data.minStock) || data.minStock < 0) {
                errors.push('Minimum stock must be a positive number');
            }
        }

        // Status validation
        if (data.status && !['active', 'inactive'].includes(data.status)) {
            errors.push('Status must be either "active" or "inactive"');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    // ============================================================
    // NORMALIZATION (UPDATED)
    // ============================================================

    /**
     * Normalize product data before saving
     * @param {Object} data - Product data to normalize
     * @returns {Object} - Normalized product data
     */
    normalizeProduct(data) {
        const normalized = { ...data };

        // Trim string fields
        if (normalized.name) normalized.name = normalized.name.trim();
        if (normalized.code) normalized.code = normalized.code.trim().toUpperCase();
        if (normalized.category) normalized.category = normalized.category.trim();
        if (normalized.brand) normalized.brand = normalized.brand.trim();
        if (normalized.description) normalized.description = normalized.description.trim();
        if (normalized.hsn) normalized.hsn = normalized.hsn.trim();
        if (normalized.unit) normalized.unit = normalized.unit.trim();

        // Set default values
        if (!normalized.category) {
            normalized.category = 'General Products';
        }
        if (!normalized.unit) {
            normalized.unit = 'Nos';
        }
        if (normalized.status === undefined || normalized.status === null) {
            normalized.status = 'active';
        }
        if (normalized.sellingRate === undefined || normalized.sellingRate === null) {
            normalized.sellingRate = 0;
        }
        if (normalized.gstRate === undefined || normalized.gstRate === null) {
            normalized.gstRate = 18;
        }
        if (normalized.openingStock === undefined || normalized.openingStock === null) {
            normalized.openingStock = 0;
        }
        if (normalized.currentStock === undefined || normalized.currentStock === null) {
            normalized.currentStock = 0;
        }
        if (normalized.minStock === undefined || normalized.minStock === null) {
            normalized.minStock = 0;
        }

        // Numeric fields
        const numericFields = ['sellingRate', 'purchaseCost', 'dealerPrice', 'contractorPrice', 'mrp', 'gstRate'];
        for (const field of numericFields) {
            if (normalized[field] === undefined || normalized[field] === null) {
                normalized[field] = 0;
            }
            if (typeof normalized[field] === 'string') {
                normalized[field] = parseFloat(normalized[field]) || 0;
            }
        }

        // Stock fields
        const stockFields = ['openingStock', 'currentStock', 'minStock'];
        for (const field of stockFields) {
            if (normalized[field] === undefined || normalized[field] === null) {
                normalized[field] = 0;
            }
            if (typeof normalized[field] === 'string') {
                normalized[field] = parseInt(normalized[field], 10) || 0;
            }
        }

        // Set image if not present
        if (!normalized.image) {
            normalized.image = null;
        }

        return normalized;
    }

    // ============================================================
    // CREATE PRODUCT (UPDATED)
    // ============================================================

    /**
     * Create a new product
     * @param {Object} data - Product data
     * @returns {Promise<Object>} - Created product
     */
    async createProduct(data) {
        await this.initialize();

        // Validate
        const validation = await this.validateProduct(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizeProduct(data);

        // Get existing products for code generation
        const existingProducts = await database.getAll(this._storeName);

        // Generate code if not provided
        if (!normalized.code) {
            normalized.code = this._generateProductCode(
                normalized.name,
                normalized.category,
                existingProducts
            );
        }

        // Check for duplicate code
        const duplicate = existingProducts.find(p => 
            p.code && p.code.toUpperCase() === normalized.code.toUpperCase()
        );
        if (duplicate) {
            throw new Error(`Product with code ${normalized.code} already exists`);
        }

        // Generate ID
        const id = this._generateProductId();

        // Prepare product object
        const now = new Date().toISOString();
        const product = {
            id: id,
            code: normalized.code,
            name: normalized.name,
            category: normalized.category,
            brand: normalized.brand || '',
            description: normalized.description || '',
            unit: normalized.unit,
            hsn: normalized.hsn || '',
            gstRate: normalized.gstRate || 0,
            sellingRate: normalized.sellingRate || 0,
            purchaseCost: normalized.purchaseCost || 0,
            dealerPrice: normalized.dealerPrice || 0,
            contractorPrice: normalized.contractorPrice || 0,
            mrp: normalized.mrp || 0,
            image: normalized.image || null,
            openingStock: normalized.openingStock || 0,
            currentStock: normalized.currentStock || 0,
            minStock: normalized.minStock || 0,
            status: normalized.status || 'active',
            createdAt: now,
            updatedAt: now
        };

        // Save to database
        await database.add(this._storeName, product);

        // Update state
        try {
            const products = await database.getAll(this._storeName);
            state.set('products', products);
            state.set('selectedProduct', product);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.PRODUCT_ADDED,
            {
                id: product.id,
                name: product.name,
                code: product.code,
                data: product
            },
            'product-service'
        );

        console.log(`📦 Product created: ${product.name} (${product.code})`);
        return product;
    }

    // ============================================================
    // GET PRODUCT
    // ============================================================

    /**
     * Get a product by ID
     * @param {string} id - Product ID
     * @returns {Promise<Object|null>} - Product or null
     */
    async getProduct(id) {
        await this.initialize();
        return database.get(this._storeName, id);
    }

    /**
     * Get a product by code
     * @param {string} code - Product code
     * @returns {Promise<Object|null>} - Product or null
     */
    async getProductByCode(code) {
        await this.initialize();
        const allProducts = await database.getAll(this._storeName);
        return allProducts.find(p => p.code && p.code.toUpperCase() === code.toUpperCase()) || null;
    }

    // ============================================================
    // GET ALL PRODUCTS
    // ============================================================

    /**
     * Get all products with options
     * @param {Object} options - Query options
     * @param {boolean} options.activeOnly - Only return active products
     * @param {string} options.category - Filter by category
     * @param {string} options.sortBy - Field to sort by
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @param {number} options.limit - Maximum number of results
     * @param {number} options.offset - Number of results to skip
     * @returns {Promise<Array>} - Array of products
     */
    async getProducts(options = {}) {
        await this.initialize();

        let products = await database.getAll(this._storeName);

        // Filter active only
        if (options.activeOnly) {
            products = products.filter(p => p.status === 'active');
        }

        // Filter by category
        if (options.category && options.category !== 'all') {
            products = products.filter(p => p.category === options.category);
        }

        // Sort
        if (options.sortBy) {
            const direction = options.sortDirection === 'desc' ? -1 : 1;
            products.sort((a, b) => {
                const aVal = (a[options.sortBy] || '').toString().toLowerCase();
                const bVal = (b[options.sortBy] || '').toString().toLowerCase();
                return aVal < bVal ? -1 * direction : aVal > bVal ? 1 * direction : 0;
            });
        }

        // Pagination
        if (options.limit) {
            const offset = options.offset || 0;
            products = products.slice(offset, offset + options.limit);
        }

        return products;
    }

    /**
     * Get products by category
     * @param {string} category - Category name
     * @param {boolean} activeOnly - Only return active products
     * @returns {Promise<Array>} - Array of products
     */
    async getProductsByCategory(category, activeOnly = true) {
        await this.initialize();
        const products = await database.getAll(this._storeName);
        return products.filter(p => {
            const matchCategory = p.category === category;
            const matchActive = activeOnly ? p.status === 'active' : true;
            return matchCategory && matchActive;
        });
    }

    // ============================================================
    // UPDATE PRODUCT (UPDATED)
    // ============================================================

    /**
     * Update an existing product
     * @param {string} id - Product ID
     * @param {Object} updates - Updated fields
     * @returns {Promise<Object>} - Updated product
     */
    async updateProduct(id, updates) {
        await this.initialize();

        // Get existing product
        const existing = await database.get(this._storeName, id);
        if (!existing) {
            throw new Error(`Product not found: ${id}`);
        }

        // Merge updates with existing
        const merged = { ...existing, ...updates };

        // Validate merged data
        const validation = await this.validateProduct(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizeProduct(merged);

        // Check for duplicate code (if code changed)
        if (normalized.code && normalized.code !== existing.code) {
            const allProducts = await database.getAll(this._storeName);
            const duplicate = allProducts.find(p => 
                p.code && p.code.toUpperCase() === normalized.code.toUpperCase() &&
                p.id !== id
            );
            if (duplicate) {
                throw new Error(`Product with code ${normalized.code} already exists`);
            }
        }

        // Preserve ID and timestamps
        const updatedProduct = {
            ...normalized,
            id: id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
        };

        // Save to database
        await database.put(this._storeName, updatedProduct);

        // Update state
        try {
            const products = await database.getAll(this._storeName);
            state.set('products', products);
            state.set('selectedProduct', updatedProduct);
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.PRODUCT_UPDATED,
            {
                id: updatedProduct.id,
                name: updatedProduct.name,
                code: updatedProduct.code,
                data: updatedProduct
            },
            'product-service'
        );

        console.log(`📦 Product updated: ${updatedProduct.name} (${updatedProduct.code})`);
        return updatedProduct;
    }

    // ============================================================
    // DELETE PRODUCT
    // ============================================================

    /**
     * Delete a product
     * IMPORTANT: Historical invoices/quotations remain intact
     * because they store productSnapshot
     * @param {string} id - Product ID
     * @returns {Promise<Object>} - Result
     */
    async deleteProduct(id) {
        await this.initialize();

        const product = await database.get(this._storeName, id);
        if (!product) {
            throw new Error(`Product not found: ${id}`);
        }

        await database.delete(this._storeName, id);

        try {
            const products = await database.getAll(this._storeName);
            state.set('products', products);
            if (state.get('selectedProduct')?.id === id) {
                state.set('selectedProduct', null);
            }
        } catch (error) {
            // State update is optional
        }

        await eventBus.emit(
            EVENTS.PRODUCT_DELETED,
            {
                id: product.id,
                name: product.name,
                code: product.code,
                data: product
            },
            'product-service'
        );

        console.log(`📦 Product deleted: ${product.name} (${product.code})`);
        return { success: true, id: id, name: product.name };
    }

    // ============================================================
    // SEARCH PRODUCTS (UPDATED)
    // ============================================================

    /**
     * Search products by multiple fields
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @param {boolean} options.activeOnly - Only search active products
     * @param {string} options.category - Filter by category
     * @param {number} options.limit - Maximum results
     * @returns {Promise<Array>} - Matching products
     */
    async searchProducts(query, options = {}) {
        await this.initialize();

        if (!query || query.trim() === '') {
            return this.getProducts({
                activeOnly: options.activeOnly,
                category: options.category,
                limit: options.limit
            });
        }

        const term = query.toLowerCase().trim();
        let products = await database.getAll(this._storeName);

        if (options.activeOnly) {
            products = products.filter(p => p.status === 'active');
        }

        if (options.category && options.category !== 'all') {
            products = products.filter(p => p.category === options.category);
        }

        const results = products.filter(product => {
            const searchableFields = [
                product.name,
                product.code,
                product.category,
                product.brand,
                product.description,
                product.hsn,
                product.unit
            ];

            return searchableFields.some(field => {
                if (!field) return false;
                return String(field).toLowerCase().includes(term);
            });
        });

        if (options.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    // ============================================================
    // FIND DUPLICATE PRODUCT
    // ============================================================

    /**
     * Find potential duplicate products
     * @param {Object} data - Product data to check
     * @returns {Promise<Object|null>} - Duplicate product or null
     */
    async findDuplicateProduct(data) {
        await this.initialize();

        const products = await database.getAll(this._storeName);

        // Check by code
        if (data.code) {
            const duplicate = products.find(p =>
                p.code && p.code.toUpperCase() === data.code.toUpperCase() &&
                p.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        // Check by name (exact match)
        if (data.name) {
            const duplicate = products.find(p =>
                p.name && p.name.toLowerCase() === data.name.toLowerCase() &&
                p.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        return null;
    }

    // ============================================================
    // CREATE PRODUCT SNAPSHOT (UPDATED)
    // ============================================================

    /**
     * Create a snapshot of a product for invoices/quotations
     * This preserves product data at the time of document creation
     * @param {Object|string} product - Product object or ID
     * @returns {Promise<Object>} - Product snapshot
     */
    async createProductSnapshot(product) {
        await this.initialize();

        let productData = product;

        if (typeof product === 'string') {
            productData = await database.get(this._storeName, product);
            if (!productData) {
                throw new Error(`Product not found: ${product}`);
            }
        }

        return {
            id: productData.id,
            code: productData.code || '',
            name: productData.name || '',
            category: productData.category || '',
            description: productData.description || '',
            hsn: productData.hsn || '',
            unit: productData.unit || 'Nos',
            gstRate: productData.gstRate || 0,
            sellingRate: productData.sellingRate || 0
        };
    }

    // ============================================================
    // SET PRODUCT STATUS
    // ============================================================

    /**
     * Set product status (active/inactive)
     * @param {string} id - Product ID
     * @param {string} status - 'active' or 'inactive'
     * @returns {Promise<Object>} - Updated product
     */
    async setProductStatus(id, status) {
        await this.initialize();

        if (!['active', 'inactive'].includes(status)) {
            throw new Error('Status must be "active" or "inactive"');
        }

        const product = await database.get(this._storeName, id);
        if (!product) {
            throw new Error(`Product not found: ${id}`);
        }

        return this.updateProduct(id, { status: status });
    }

    // ============================================================
    // UPDATE STOCK
    // ============================================================

    /**
     * Update product stock
     * @param {string} id - Product ID
     * @param {number} quantity - Quantity to add (positive) or remove (negative)
     * @param {string} type - 'add' or 'remove'
     * @returns {Promise<Object>} - Updated product
     */
    async updateStock(id, quantity, type = 'add') {
        await this.initialize();

        const product = await database.get(this._storeName, id);
        if (!product) {
            throw new Error(`Product not found: ${id}`);
        }

        const currentStock = product.currentStock || 0;
        let newStock;

        if (type === 'add') {
            newStock = currentStock + quantity;
        } else if (type === 'remove') {
            if (quantity > currentStock) {
                throw new Error(`Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`);
            }
            newStock = currentStock - quantity;
        } else {
            throw new Error('Type must be "add" or "remove"');
        }

        return this.updateProduct(id, { currentStock: newStock });
    }

    // ============================================================
    // PRODUCT STATISTICS (UPDATED)
    // ============================================================

    /**
     * Get product statistics
     * @returns {Promise<Object>} - Product statistics
     */
    async getProductStats() {
        await this.initialize();

        const products = await database.getAll(this._storeName);
        const total = products.length;
        const active = products.filter(p => p.status === 'active').length;
        const inactive = total - active;

        // Count by category
        const byCategory = {};
        for (const product of products) {
            const category = product.category || 'Uncategorized';
            byCategory[category] = (byCategory[category] || 0) + 1;
        }

        // Stock summary
        const totalStock = products.reduce((sum, p) => sum + (p.currentStock || 0), 0);
        const lowStockItems = products.filter(p => (p.currentStock || 0) <= (p.minStock || 0) && p.status === 'active');
        const outOfStock = products.filter(p => (p.currentStock || 0) <= 0 && p.status === 'active');

        return {
            total: total,
            active: active,
            inactive: inactive,
            byCategory: byCategory,
            totalStock: totalStock,
            lowStockItems: lowStockItems.length,
            outOfStock: outOfStock.length,
            categories: Object.keys(byCategory)
        };
    }

    /**
     * Count total products
     * @returns {Promise<number>}
     */
    async countProducts() {
        await this.initialize();
        return database.count(this._storeName);
    }

    /**
     * Count active products
     * @returns {Promise<number>}
     */
    async countActiveProducts() {
        await this.initialize();
        const products = await database.getAll(this._storeName);
        return products.filter(p => p.status === 'active').length;
    }

    /**
     * Get low stock products
     * @param {number} threshold - Optional threshold override
     * @returns {Promise<Array>} - Products with low stock
     */
    async getLowStockProducts(threshold = null) {
        await this.initialize();
        const products = await database.getAll(this._storeName);
        return products.filter(p => {
            const min = threshold !== null ? threshold : (p.minStock || 0);
            return (p.currentStock || 0) <= min && p.status === 'active';
        });
    }

    /**
     * Get out of stock products
     * @returns {Promise<Array>} - Products with zero stock
     */
    async getOutOfStockProducts() {
        await this.initialize();
        const products = await database.getAll(this._storeName);
        return products.filter(p => (p.currentStock || 0) <= 0 && p.status === 'active');
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Bulk delete products
     * @param {Array<string>} ids - Product IDs to delete
     * @returns {Promise<Object>} - Results
     */
    async bulkDeleteProducts(ids) {
        await this.initialize();

        const results = {
            success: [],
            failed: []
        };

        for (const id of ids) {
            try {
                await this.deleteProduct(id);
                results.success.push(id);
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }

        return results;
    }

    /**
     * Bulk set status
     * @param {Array<string>} ids - Product IDs
     * @param {string} status - 'active' or 'inactive'
     * @returns {Promise<Object>} - Results
     */
    async bulkSetStatus(ids, status) {
        await this.initialize();

        const results = {
            success: [],
            failed: []
        };

        for (const id of ids) {
            try {
                await this.setProductStatus(id, status);
                results.success.push(id);
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }

        return results;
    }

    /**
     * Bulk update category
     * @param {Array<string>} ids - Product IDs
     * @param {string} category - New category
     * @returns {Promise<Object>} - Results
     */
    async bulkUpdateCategory(ids, category) {
        await this.initialize();

        const categories = await this.getCategories();
        if (!categories.includes(category)) {
            throw new Error(`Invalid category: ${category}`);
        }

        const results = {
            success: [],
            failed: []
        };

        for (const id of ids) {
            try {
                await this.updateProduct(id, { category: category });
                results.success.push(id);
            } catch (error) {
                results.failed.push({ id, error: error.message });
            }
        }

        return results;
    }

    // ============================================================
    // EXPORT / IMPORT (UPDATED)
    // ============================================================

    /**
     * Export products to CSV
     * @param {Array} products - Products to export
     * @param {Object} options - Export options
     * @returns {string} - CSV string
     */
    exportToCSV(products, options = {}) {
        const headers = [
            'ID', 'Code', 'Name', 'Category', 'Brand', 'Description',
            'Unit', 'HSN', 'GST Rate', 'Selling Rate', 'Purchase Cost',
            'Dealer Price', 'Contractor Price', 'MRP',
            'Opening Stock', 'Current Stock', 'Minimum Stock', 'Status',
            'Created At', 'Updated At'
        ];

        const rows = products.map(p => [
            p.id || '',
            p.code || '',
            p.name || '',
            p.category || '',
            p.brand || '',
            p.description || '',
            p.unit || 'Nos',
            p.hsn || '',
            p.gstRate || 0,
            p.sellingRate || 0,
            p.purchaseCost || 0,
            p.dealerPrice || 0,
            p.contractorPrice || 0,
            p.mrp || 0,
            p.openingStock || 0,
            p.currentStock || 0,
            p.minStock || 0,
            p.status || 'active',
            p.createdAt || '',
            p.updatedAt || ''
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Import products from CSV
     * @param {string} csv - CSV string
     * @param {Object} options - Import options
     * @returns {Promise<Array>} - Imported product IDs
     */
    async importFromCSV(csv, options = {}) {
        await this.initialize();

        const lines = csv.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV must contain headers and at least one row');
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const importedIds = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const product = {};

            for (let j = 0; j < headers.length; j++) {
                const key = headers[j];
                const value = values[j] || '';

                switch (key) {
                    case 'ID': product.id = value; break;
                    case 'Code': product.code = value; break;
                    case 'Name': product.name = value; break;
                    case 'Category': product.category = value; break;
                    case 'Brand': product.brand = value; break;
                    case 'Description': product.description = value; break;
                    case 'Unit': product.unit = value; break;
                    case 'HSN': product.hsn = value; break;
                    case 'GST Rate': product.gstRate = parseFloat(value) || 0; break;
                    case 'Selling Rate': product.sellingRate = parseFloat(value) || 0; break;
                    case 'Purchase Cost': product.purchaseCost = parseFloat(value) || 0; break;
                    case 'Dealer Price': product.dealerPrice = parseFloat(value) || 0; break;
                    case 'Contractor Price': product.contractorPrice = parseFloat(value) || 0; break;
                    case 'MRP': product.mrp = parseFloat(value) || 0; break;
                    case 'Opening Stock': product.openingStock = parseInt(value, 10) || 0; break;
                    case 'Current Stock': product.currentStock = parseInt(value, 10) || 0; break;
                    case 'Minimum Stock': product.minStock = parseInt(value, 10) || 0; break;
                    case 'Status': product.status = value === 'active' ? 'active' : 'inactive'; break;
                    case 'Created At': product.createdAt = value; break;
                    case 'Updated At': product.updatedAt = value; break;
                }
            }

            if (!product.name) continue;

            try {
                const created = await this.createProduct(product);
                importedIds.push(created.id);
            } catch (error) {
                console.warn(`Failed to import product ${product.name}:`, error);
            }
        }

        return importedIds;
    }

    /**
     * Refresh all caches
     * @returns {Promise<void>}
     */
    async refreshAll() {
        await this.refreshCache();
    }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

const productService = new ProductService();

// ============================================================
// EXPORT
// ============================================================

export { productService };
export default productService;

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → products store
// SETTINGS: H4BillingERP → settings store (categories & units)
// EVENTS: PRODUCT_ADDED, PRODUCT_UPDATED, PRODUCT_DELETED, SETTINGS_UPDATED
// 
// UPDATED DATA MODEL:
// ✅ code - Product code (e.g., H4-TA-C1)
// ✅ name - Product name
// ✅ category - Product category
// ✅ brand - Brand name
// ✅ description - Product description
// ✅ unit - Unit of measurement
// ✅ hsn - HSN/SAC code
// ✅ gstRate - GST rate (%)
// ✅ sellingRate - Default selling rate
// ✅ purchaseCost - Purchase cost
// ✅ dealerPrice - Dealer price
// ✅ contractorPrice - Contractor price
// ✅ mrp - Maximum Retail Price
// ✅ image - Product image (base64)
// ✅ openingStock - Opening stock quantity
// ✅ currentStock - Current stock quantity
// ✅ minStock - Minimum stock alert level
// ✅ status - 'active' or 'inactive'
// ✅ createdAt - Creation timestamp
// ✅ updatedAt - Last update timestamp
// 
// ============================================================