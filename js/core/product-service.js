/**
 * H4 Billing ERP - Product Service Module
 * Central service for all product-related operations
 * Version: 1.0.0
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
 * PRODUCT DATA MODEL
 * ============================================================
 * 
 * id              - Unique product ID
 * name            - Product name
 * supplierId      - Supplier customer ID
 * supplierMobile  - Supplier mobile number
 * code            - Product code
 * sku             - Stock Keeping Unit
 * category        - Product category
 * brand           - Brand name
 * description     - Product description
 * hsn             - HSN/SAC code
 * unit            - Unit of measurement
 * purchaseRate    - Purchase rate
 * sellingRate     - Selling rate
 * mrp             - Maximum Retail Price
 * priceSlabs      - Quantity-based pricing
 * imageIds        - Associated image IDs
 * notes           - Additional notes
 * active          - Active status
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
 * - Does NOT add GST fields to Product Master
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

        // Validate
        if (!category || category.trim() === '') {
            throw new Error('Category name is required');
        }

        const trimmed = category.trim();
        
        // Get current categories
        const currentCategories = await this.getCategories(true);
        
        // Check for duplicate (case-insensitive)
        const duplicate = currentCategories.find(
            c => c.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (duplicate) {
            throw new Error(`Category "${trimmed}" already exists`);
        }

        // Add new category
        const updatedCategories = [...currentCategories, trimmed];
        await this._saveCategories(updatedCategories);

        // Update cache
        this._categoriesCache = [...updatedCategories];
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('productCategories', updatedCategories);
        } catch (error) {
            // State update is optional
        }

        // Emit settings updated event
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
        
        // Get current categories
        const currentCategories = await this.getCategories(true);
        
        // Check if category exists
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

        // Remove category
        const updatedCategories = currentCategories.filter(
            c => c.toLowerCase() !== trimmed.toLowerCase()
        );
        await this._saveCategories(updatedCategories);

        // Update cache
        this._categoriesCache = [...updatedCategories];
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('productCategories', updatedCategories);
        } catch (error) {
            // State update is optional
        }

        // Emit settings updated event
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
        // Get existing settings
        let settings = await database.get(this._settingsStoreName, this._settingsId);
        
        if (!settings) {
            // Create settings if it doesn't exist
            settings = {
                id: this._settingsId,
                productCategories: categories,
                productUnits: DEFAULT_UNITS,
                updatedAt: new Date().toISOString()
            };
            await database.add(this._settingsStoreName, settings);
        } else {
            // Update existing settings
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

        // Check cache
        if (!forceRefresh && this._unitsCache && 
            (Date.now() - this._lastCacheUpdate < this._cacheTimeout)) {
            return [...this._unitsCache];
        }

        // Get settings
        const settings = await database.get(this._settingsStoreName, this._settingsId);
        
        let units;
        if (settings && settings.productUnits && Array.isArray(settings.productUnits)) {
            units = settings.productUnits;
        } else {
            // If settings don't exist or don't have units, use defaults
            units = [...DEFAULT_UNITS];
            // Save defaults to settings
            await this._saveUnits(units);
        }

        // Update cache
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

        // Validate
        if (!unit || unit.trim() === '') {
            throw new Error('Unit name is required');
        }

        const trimmed = unit.trim();
        
        // Get current units
        const currentUnits = await this.getUnits(true);
        
        // Check for duplicate (case-insensitive)
        const duplicate = currentUnits.find(
            u => u.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (duplicate) {
            throw new Error(`Unit "${trimmed}" already exists`);
        }

        // Add new unit
        const updatedUnits = [...currentUnits, trimmed];
        await this._saveUnits(updatedUnits);

        // Update cache
        this._unitsCache = [...updatedUnits];
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('productUnits', updatedUnits);
        } catch (error) {
            // State update is optional
        }

        // Emit settings updated event
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
        
        // Get current units
        const currentUnits = await this.getUnits(true);
        
        // Check if unit exists
        const exists = currentUnits.find(
            u => u.toLowerCase() === trimmed.toLowerCase()
        );
        
        if (!exists) {
            throw new Error(`Unit "${trimmed}" not found`);
        }

        // Don't allow removing if products are using this unit
        const products = await this.getProducts({ activeOnly: false });
        const productsUsingUnit = products.filter(p => p.unit === trimmed);
        if (productsUsingUnit.length > 0) {
            throw new Error(
                `Cannot remove unit "${trimmed}" because it is used by ${productsUsingUnit.length} product(s)`
            );
        }

        // Remove unit
        const updatedUnits = currentUnits.filter(
            u => u.toLowerCase() !== trimmed.toLowerCase()
        );
        await this._saveUnits(updatedUnits);

        // Update cache
        this._unitsCache = [...updatedUnits];
        this._lastCacheUpdate = Date.now();

        // Update state
        try {
            state.set('productUnits', updatedUnits);
        } catch (error) {
            // State update is optional
        }

        // Emit settings updated event
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
        // Get existing settings
        let settings = await database.get(this._settingsStoreName, this._settingsId);
        
        if (!settings) {
            // Create settings if it doesn't exist
            settings = {
                id: this._settingsId,
                productCategories: DEFAULT_CATEGORIES,
                productUnits: units,
                updatedAt: new Date().toISOString()
            };
            await database.add(this._settingsStoreName, settings);
        } else {
            // Update existing settings
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
    // GENERATE PRODUCT ID / SKU
    // ============================================================

    /**
     * Generate a product ID
     * @returns {string} - Product ID
     */
    _generateProductId() {
        if (database.generateId && typeof database.generateId === 'function') {
            return database.generateId();
        }
        return crypto.randomUUID();
    }

    /**
     * Generate a SKU if not provided
     * @param {string} name - Product name
     * @param {string} category - Product category
     * @returns {string} - Generated SKU
     */
    _generateSku(name, category) {
        const prefix = category ? category.substring(0, 3).toUpperCase() : 'PRD';
        const namePart = name ? name.substring(0, 5).toUpperCase() : 'PROD';
        const random = Math.floor(1000 + Math.random() * 9000);
        return `${prefix}-${namePart}-${random}`;
    }

    // ============================================================
    // VALIDATION (UPDATED - uses persistent categories/units)
    // ============================================================

    /**
     * Validate product data
     * @param {Object} data - Product data to validate
     * @param {string} data.id - Product ID (optional, for update)
     * @returns {Promise<Object>} - { valid: boolean, errors: Array<string> }
     */
    async validateProduct(data) {
        const errors = [];

        // Name is required
        if (!data.name || data.name.trim() === '') {
            errors.push('Product name is required');
        }

        // Category validation - get current categories
        if (data.category) {
            const categories = await this.getCategories();
            if (!categories.includes(data.category)) {
                errors.push(`Invalid category: ${data.category}. Valid categories: ${categories.join(', ')}`);
            }
        }

        // Unit validation - get current units
        if (data.unit) {
            const units = await this.getUnits();
            if (!units.includes(data.unit)) {
                errors.push(`Invalid unit: ${data.unit}. Valid units: ${units.join(', ')}`);
            }
        }

        // Rate validation
        if (data.sellingRate !== undefined && data.sellingRate !== null) {
            if (isNaN(data.sellingRate) || data.sellingRate < 0) {
                errors.push('Selling rate must be a positive number');
            }
        }

        if (data.purchaseRate !== undefined && data.purchaseRate !== null) {
            if (isNaN(data.purchaseRate) || data.purchaseRate < 0) {
                errors.push('Purchase rate must be a positive number');
            }
        }

        if (data.mrp !== undefined && data.mrp !== null) {
            if (isNaN(data.mrp) || data.mrp < 0) {
                errors.push('MRP must be a positive number');
            }
        }

        // Price slabs validation
        if (data.priceSlabs && Array.isArray(data.priceSlabs)) {
            for (const slab of data.priceSlabs) {
                if (slab.minQty === undefined || slab.minQty === null) {
                    errors.push('Price slab missing minimum quantity');
                }
                if (slab.rate === undefined || slab.rate === null || isNaN(slab.rate) || slab.rate < 0) {
                    errors.push('Price slab rate must be a positive number');
                }
                if (slab.minQty !== null && slab.maxQty !== null && slab.minQty > slab.maxQty) {
                    errors.push('Price slab minimum quantity cannot be greater than maximum quantity');
                }
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
     * Normalize product data before saving
     * @param {Object} data - Product data to normalize
     * @returns {Object} - Normalized product data
     */
    normalizeProduct(data) {
        const normalized = { ...data };

        // Trim string fields
        if (normalized.name) normalized.name = normalized.name.trim();
        if (normalized.code) normalized.code = normalized.code.trim().toUpperCase();
        if (normalized.sku) normalized.sku = normalized.sku.trim().toUpperCase();
        if (normalized.category) normalized.category = normalized.category.trim();
        if (normalized.brand) normalized.brand = normalized.brand.trim();
        if (normalized.description) normalized.description = normalized.description.trim();
        if (normalized.hsn) normalized.hsn = normalized.hsn.trim();
        if (normalized.unit) normalized.unit = normalized.unit.trim();
        if (normalized.notes) normalized.notes = normalized.notes.trim();
        if (normalized.supplierId) normalized.supplierId = normalized.supplierId.trim();
        if (normalized.supplierMobile) normalized.supplierMobile = normalized.supplierMobile.trim();

        // Set default values
        if (!normalized.category) {
            normalized.category = 'General Products';
        }
        if (!normalized.unit) {
            normalized.unit = 'Nos';
        }
        if (normalized.active === undefined || normalized.active === null) {
            normalized.active = true;
        }
        if (normalized.sellingRate === undefined || normalized.sellingRate === null) {
            normalized.sellingRate = 0;
        }
        if (normalized.purchaseRate === undefined || normalized.purchaseRate === null) {
            normalized.purchaseRate = 0;
        }
        if (normalized.mrp === undefined || normalized.mrp === null) {
            normalized.mrp = 0;
        }

        // Ensure price slabs is an array
        if (!normalized.priceSlabs || !Array.isArray(normalized.priceSlabs)) {
            normalized.priceSlabs = [];
        }

        // Ensure imageIds is an array
        if (!normalized.imageIds || !Array.isArray(normalized.imageIds)) {
            normalized.imageIds = [];
        }

        return normalized;
    }

    // ============================================================
    // CREATE PRODUCT
    // ============================================================

    /**
     * Create a new product
     * @param {Object} data - Product data
     * @returns {Promise<Object>} - Created product
     */
    async createProduct(data) {
        await this.initialize();

        // Validate (async)
        const validation = await this.validateProduct(data);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize
        const normalized = this.normalizeProduct(data);

        // Generate SKU if not provided
        if (!normalized.sku) {
            normalized.sku = this._generateSku(normalized.name, normalized.category);
        }

        // Check for duplicate SKU
        const duplicate = await this.findDuplicateProduct(normalized);
        if (duplicate) {
            throw new Error(`Product with SKU ${normalized.sku} already exists`);
        }

        // Generate ID
        const id = this._generateProductId();

        // Prepare product object
        const now = new Date().toISOString();
        const product = {
            id: id,
            name: normalized.name,
            supplierId: normalized.supplierId || '',
            supplierMobile: normalized.supplierMobile || '',
            code: normalized.code || '',
            sku: normalized.sku,
            category: normalized.category,
            brand: normalized.brand || '',
            description: normalized.description || '',
            hsn: normalized.hsn || '',
            unit: normalized.unit,
            purchaseRate: normalized.purchaseRate || 0,
            sellingRate: normalized.sellingRate || 0,
            mrp: normalized.mrp || 0,
            priceSlabs: normalized.priceSlabs || [],
            imageIds: normalized.imageIds || [],
            notes: normalized.notes || '',
            active: normalized.active !== false,
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
                sku: product.sku,
                data: product
            },
            'product-service'
        );

        console.log(`📦 Product created: ${product.name} (${product.sku})`);
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
     * Get a product by SKU
     * @param {string} sku - Product SKU
     * @returns {Promise<Object|null>} - Product or null
     */
    async getProductBySku(sku) {
        await this.initialize();
        const allProducts = await database.getAll(this._storeName);
        return allProducts.find(p => p.sku && p.sku.toUpperCase() === sku.toUpperCase()) || null;
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
            products = products.filter(p => p.active !== false);
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
            const matchActive = activeOnly ? p.active !== false : true;
            return matchCategory && matchActive;
        });
    }

    // ============================================================
    // UPDATE PRODUCT
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

        // Validate merged data (async)
        const validation = await this.validateProduct(merged);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Normalize merged data
        const normalized = this.normalizeProduct(merged);

        // Check for duplicate SKU (if SKU changed)
        if (normalized.sku && normalized.sku !== existing.sku) {
            const duplicate = await this.findDuplicateProduct(normalized);
            if (duplicate && duplicate.id !== id) {
                throw new Error(`Product with SKU ${normalized.sku} already exists`);
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
                sku: updatedProduct.sku,
                data: updatedProduct
            },
            'product-service'
        );

        console.log(`📦 Product updated: ${updatedProduct.name} (${updatedProduct.sku})`);
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

        // Get product before deletion (for event)
        const product = await database.get(this._storeName, id);
        if (!product) {
            throw new Error(`Product not found: ${id}`);
        }

        // Delete from database
        await database.delete(this._storeName, id);

        // Update state
        try {
            const products = await database.getAll(this._storeName);
            state.set('products', products);
            if (state.get('selectedProduct')?.id === id) {
                state.set('selectedProduct', null);
            }
        } catch (error) {
            // State update is optional
        }

        // Emit event
        await eventBus.emit(
            EVENTS.PRODUCT_DELETED,
            {
                id: product.id,
                name: product.name,
                sku: product.sku,
                data: product
            },
            'product-service'
        );

        console.log(`📦 Product deleted: ${product.name} (${product.sku})`);
        return { success: true, id: id, name: product.name };
    }

    // ============================================================
    // SEARCH PRODUCTS
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

        // Filter active only
        if (options.activeOnly) {
            products = products.filter(p => p.active !== false);
        }

        // Filter by category
        if (options.category && options.category !== 'all') {
            products = products.filter(p => p.category === options.category);
        }

        // Search in fields
        const results = products.filter(product => {
            const searchableFields = [
                product.name,
                product.code,
                product.sku,
                product.category,
                product.brand,
                product.description,
                product.hsn,
                product.supplierId,
                product.supplierMobile
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
    // FIND DUPLICATE PRODUCT
    // ============================================================

    /**
     * Find potential duplicate products
     * @param {Object} data - Product data to check
     * @param {string} data.id - Optional ID to exclude from search
     * @returns {Promise<Object|null>} - Duplicate product or null
     */
    async findDuplicateProduct(data) {
        await this.initialize();

        const products = await database.getAll(this._storeName);

        // Check by SKU
        if (data.sku) {
            const duplicate = products.find(p =>
                p.sku && p.sku.toUpperCase() === data.sku.toUpperCase() &&
                p.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        // Check by code
        if (data.code) {
            const duplicate = products.find(p =>
                p.code && p.code.toUpperCase() === data.code.toUpperCase() &&
                p.id !== data.id
            );
            if (duplicate) return duplicate;
        }

        // Check by name (fuzzy - exact match only)
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
    // CREATE PRODUCT SNAPSHOT
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

        // If ID is provided, fetch the product
        if (typeof product === 'string') {
            productData = await database.get(this._storeName, product);
            if (!productData) {
                throw new Error(`Product not found: ${product}`);
            }
        }

        // Return snapshot with document-relevant fields
        return {
            id: productData.id,
            name: productData.name || '',
            sku: productData.sku || '',
            code: productData.code || '',
            category: productData.category || '',
            description: productData.description || '',
            hsn: productData.hsn || '',
            unit: productData.unit || 'Nos',
            sellingRate: productData.sellingRate || 0
        };
    }

    /**
     * Get product rate considering price slabs
     * @param {Object|string} product - Product object or ID
     * @param {number} quantity - Quantity for slab calculation
     * @returns {Promise<number>} - Applicable rate
     */
    async getProductRate(product, quantity) {
        await this.initialize();

        let productData = product;

        // If ID is provided, fetch the product
        if (typeof product === 'string') {
            productData = await database.get(this._storeName, product);
            if (!productData) {
                throw new Error(`Product not found: ${product}`);
            }
        }

        // If no price slabs, return selling rate
        if (!productData.priceSlabs || productData.priceSlabs.length === 0) {
            return productData.sellingRate || 0;
        }

        // Sort slabs by minQty
        const sortedSlabs = [...productData.priceSlabs].sort((a, b) => a.minQty - b.minQty);

        // Find applicable slab
        for (const slab of sortedSlabs) {
            if (quantity >= slab.minQty) {
                if (slab.maxQty === null || quantity <= slab.maxQty) {
                    return slab.rate;
                }
            }
        }

        // If no slab matches, return the last slab's rate or selling rate
        const lastSlab = sortedSlabs[sortedSlabs.length - 1];
        if (lastSlab && lastSlab.maxQty === null) {
            return lastSlab.rate;
        }

        return productData.sellingRate || 0;
    }

    // ============================================================
    // SET PRODUCT ACTIVE STATUS
    // ============================================================

    /**
     * Set product active status
     * @param {string} id - Product ID
     * @param {boolean} active - Active status
     * @returns {Promise<Object>} - Updated product
     */
    async setProductActive(id, active) {
        await this.initialize();

        const product = await database.get(this._storeName, id);
        if (!product) {
            throw new Error(`Product not found: ${id}`);
        }

        return this.updateProduct(id, { active: active });
    }

    // ============================================================
    // PRODUCT STATISTICS
    // ============================================================

    /**
     * Get product statistics
     * @returns {Promise<Object>} - Product statistics
     */
    async getProductStats() {
        await this.initialize();

        const products = await database.getAll(this._storeName);
        const total = products.length;
        const active = products.filter(p => p.active !== false).length;
        const inactive = total - active;

        // Count by category
        const byCategory = {};
        for (const product of products) {
            const category = product.category || 'Uncategorized';
            byCategory[category] = (byCategory[category] || 0) + 1;
        }

        // Count products with price slabs
        const withPriceSlabs = products.filter(p => p.priceSlabs && p.priceSlabs.length > 0).length;

        // Count products with supplier
        const withSupplier = products.filter(p => p.supplierId || p.supplierMobile).length;

        return {
            total: total,
            active: active,
            inactive: inactive,
            byCategory: byCategory,
            withPriceSlabs: withPriceSlabs,
            withSupplier: withSupplier,
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
        return products.filter(p => p.active !== false).length;
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
     * Bulk set active status
     * @param {Array<string>} ids - Product IDs
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
                await this.setProductActive(id, active);
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

        // Validate category
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
    // EXPORT / IMPORT
    // ============================================================

    /**
     * Export products to CSV
     * @param {Array} products - Products to export
     * @param {Object} options - Export options
     * @returns {string} - CSV string
     */
    exportToCSV(products, options = {}) {
        const includePriceSlabs = options.includePriceSlabs || false;

        let headers = [
            'ID', 'Name', 'SKU', 'Code', 'Category', 'Brand',
            'Description', 'HSN', 'Unit', 'Supplier ID', 'Supplier Mobile',
            'Purchase Rate', 'Selling Rate', 'MRP', 'Active', 'Created At'
        ];

        if (includePriceSlabs) {
            headers.push('Price Slabs');
        }

        const rows = products.map(p => {
            const row = [
                p.id || '',
                p.name || '',
                p.sku || '',
                p.code || '',
                p.category || '',
                p.brand || '',
                p.description || '',
                p.hsn || '',
                p.unit || 'Nos',
                p.supplierId || '',
                p.supplierMobile || '',
                p.purchaseRate || 0,
                p.sellingRate || 0,
                p.mrp || 0,
                p.active !== false ? 'Yes' : 'No',
                p.createdAt || ''
            ];

            if (includePriceSlabs) {
                const slabs = p.priceSlabs || [];
                row.push(JSON.stringify(slabs));
            }

            return row;
        });

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

                if (key === 'ID') product.id = value;
                else if (key === 'Name') product.name = value;
                else if (key === 'SKU') product.sku = value;
                else if (key === 'Code') product.code = value;
                else if (key === 'Category') product.category = value;
                else if (key === 'Brand') product.brand = value;
                else if (key === 'Description') product.description = value;
                else if (key === 'HSN') product.hsn = value;
                else if (key === 'Unit') product.unit = value;
                else if (key === 'Supplier ID') product.supplierId = value;
                else if (key === 'Supplier Mobile') product.supplierMobile = value;
                else if (key === 'Purchase Rate') product.purchaseRate = parseFloat(value) || 0;
                else if (key === 'Selling Rate') product.sellingRate = parseFloat(value) || 0;
                else if (key === 'MRP') product.mrp = parseFloat(value) || 0;
                else if (key === 'Active') product.active = value !== 'No';
                else if (key === 'Price Slabs') {
                    try {
                        product.priceSlabs = JSON.parse(value);
                    } catch (e) {
                        product.priceSlabs = [];
                    }
                }
            }

            // Skip empty rows
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
// USAGE EXAMPLES - CATEGORY & UNIT PERSISTENCE
// ============================================================

/*
// ============================================================
// ADD CATEGORY
// ============================================================

// Add a new category
const categories = await productService.addCategory('Construction Chemical');

// Result: categories array includes 'Construction Chemical'
// Category is saved to settings and survives page reload


// ============================================================
// GET CATEGORIES
// ============================================================

// Get all categories (includes user-added ones)
const allCategories = await productService.getCategories();

// Returns: ['Tile Adhesive', 'Waterproofing', ... , 'Construction Chemical']


// ============================================================
// ADD UNIT
// ============================================================

// Add a new unit
const units = await productService.addUnit('Drum');

// Result: units array includes 'Drum'
// Unit is saved to settings and survives page reload


// ============================================================
// GET UNITS
// ============================================================

// Get all units (includes user-added ones)
const allUnits = await productService.getUnits();

// Returns: ['Nos', 'Bag', ... , 'Drum']


// ============================================================
// REMOVE CATEGORY (with safety check)
// ============================================================

try {
    await productService.removeCategory('Construction Chemical');
} catch (error) {
    // Error if category is used by products
    console.error(error.message);
}


// ============================================================
// REMOVE UNIT (with safety check)
// ============================================================

try {
    await productService.removeUnit('Drum');
} catch (error) {
    // Error if unit is used by products
    console.error(error.message);
}


// ============================================================
// VALIDATION USES PERSISTENT CATEGORIES/UNITS
// ============================================================

// After adding 'Construction Chemical' and 'Drum':

const validation = await productService.validateProduct({
    name: 'H4 Special Chemical',
    category: 'Construction Chemical',  // ✅ Valid - exists in settings
    unit: 'Drum'                         // ✅ Valid - exists in settings
});

// validation.valid === true


// ============================================================
// LISTEN FOR SETTINGS UPDATES
// ============================================================

eventBus.on(EVENTS.SETTINGS_UPDATED, (payload) => {
    if (payload.payload.type === 'product-category-added') {
        console.log('New category added:', payload.payload.value);
        // Refresh category dropdown
        refreshCategoryDropdown();
    }
    if (payload.payload.type === 'product-unit-added') {
        console.log('New unit added:', payload.payload.value);
        // Refresh unit dropdown
        refreshUnitDropdown();
    }
});
*/

// ============================================================
// SUMMARY
// ============================================================
// 
// DATABASE: H4BillingERP → products store
// SETTINGS: H4BillingERP → settings store (categories & units)
// EVENTS: PRODUCT_ADDED, PRODUCT_UPDATED, PRODUCT_DELETED, SETTINGS_UPDATED
// 
// CATEGORY PERSISTENCE: ✅
// - addCategory() saves to settings
// - getCategories() reads from settings
// - removeCategory() removes from settings
// - Survives page reload
// - Duplicate prevention
// - Safety check for products using category
// 
// UNIT PERSISTENCE: ✅
// - addUnit() saves to settings
// - getUnits() reads from settings
// - removeUnit() removes from settings
// - Survives page reload
// - Duplicate prevention
// - Safety check for products using unit
// 
// VALIDATION: ✅
// - Uses persistent categories and units
// - New categories/units accepted immediately
// 
// CROSS-MODULE SYNC: ✅
// - EVENTS.SETTINGS_UPDATED emitted
// - State updated
// - All modules get new options
// 
// DATA MODEL: ✅
// - NO GST fields
// - NO taxMode
// 
// ============================================================