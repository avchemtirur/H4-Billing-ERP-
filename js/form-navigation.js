/**
 * H4 Billing ERP - Form Navigation
 * Version: 2.1.0
 * 
 * ============================================================
 * RESPONSIBILITY
 * ============================================================
 * 
 * Provides keyboard navigation (Enter key) through form fields.
 * - Text inputs: Enter → next field
 * - Select dropdowns: Enter → next field
 * - Textareas: Enter → next field (Shift+Enter for new line)
 * - Last field: Enter → triggers Save button
 * 
 * Android Support:
 * - Sets enterkeyhint="next" for all fields except last
 * - Sets enterkeyhint="done" for last field
 * - Shows Next/Done button on Android keyboard
 * 
 * ============================================================
 * USAGE
 * ============================================================
 * 
 * H4FormNavigation.setup([
 *     'fieldId1',
 *     'fieldId2',
 *     'fieldId3'
 * ]);
 * 
 * ============================================================
 * EXAMPLE - Product Master
 * ============================================================
 * 
 * H4FormNavigation.setup([
 *     'productCode',
 *     'productName',
 *     'productCategory',
 *     'productBrand',
 *     'productDescription',
 *     'productUnit',
 *     'productHsn',
 *     'productGstRate',
 *     'productStatus',
 *     'productSellingRate',
 *     'productPurchaseCost',
 *     'productDealerPrice',
 *     'productContractorPrice',
 *     'productMrp',
 *     'productOpeningStock',
 *     'productCurrentStock',
 *     'productMinStock'
 * ]);
 * 
 * ============================================================
 */

// ============================================================
// FORM NAVIGATION UTILITY
// ============================================================

const H4FormNavigation = (function() {
    'use strict';

    /**
     * Setup Enter key navigation for form fields
     * @param {Array<string>} fieldIds - Array of field IDs in order
     */
    function setup(fieldIds) {
        if (!fieldIds || !Array.isArray(fieldIds) || fieldIds.length === 0) {
            console.warn('⚠️ H4FormNavigation: No field IDs provided');
            return;
        }

        // Get all field elements
        const fields = fieldIds
            .map(id => document.getElementById(id))
            .filter(el => el !== null);

        if (fields.length === 0) {
            console.warn('⚠️ H4FormNavigation: No fields found on page');
            return;
        }

        console.log(`📋 H4FormNavigation: ${fields.length} fields configured`);

        // Setup each field
        fields.forEach((field, index) => {
            const isLast = (index === fields.length - 1);

            // ✅ Android: Set enterkeyhint for better keyboard UX
            if (field.tagName === 'TEXTAREA') {
                // Textarea: enterkeyhint="next" (Enter moves to next)
                field.setAttribute('enterkeyhint', isLast ? 'done' : 'next');
            } else if (field.tagName === 'SELECT') {
                // Select: enterkeyhint="next"
                field.setAttribute('enterkeyhint', isLast ? 'done' : 'next');
            } else if (field.tagName === 'INPUT') {
                // Input: enterkeyhint based on position
                field.setAttribute('enterkeyhint', isLast ? 'done' : 'next');
            }

            // Skip if already has navigation listener
            if (field.dataset.navSetup === 'true') {
                return;
            }

            field.addEventListener('keydown', function(e) {
                // Only handle Enter key
                if (e.key !== 'Enter') {
                    return;
                }

                // For textarea: Allow Shift+Enter for new line
                if (this.tagName === 'TEXTAREA' && e.shiftKey) {
                    // Allow default behavior (new line)
                    return;
                }

                // Prevent default form submission
                e.preventDefault();

                // Find next field
                const nextIndex = index + 1;
                
                if (nextIndex < fields.length) {
                    // Focus next field
                    const nextField = fields[nextIndex];
                    nextField.focus();
                    
                    // If next field is a select, open it
                    if (nextField.tagName === 'SELECT') {
                        // Most browsers handle this naturally
                    }
                    
                    // If next field is a textarea, place cursor at end
                    if (nextField.tagName === 'TEXTAREA') {
                        const len = nextField.value.length;
                        nextField.setSelectionRange(len, len);
                    }
                    
                    // Select all text in input fields
                    if (nextField.tagName === 'INPUT' && 
                        (nextField.type === 'text' || nextField.type === 'number' || nextField.type === 'tel' || nextField.type === 'email')) {
                        nextField.select();
                    }
                } else {
                    // Last field - trigger Save button
                    const saveBtn = document.getElementById('modalSave');
                    if (saveBtn) {
                        saveBtn.click();
                    } else {
                        // Fallback: try to find any save button
                        const modalSave = document.querySelector('#modalSave, .btn-save, .btn-primary[data-action="save"]');
                        if (modalSave) {
                            modalSave.click();
                        }
                    }
                }
            });

            // Mark as setup
            field.dataset.navSetup = 'true';
        });

        // Log the field order for debugging
        const fieldNames = fields.map(f => {
            const id = f.id || f.tagName;
            const hint = f.getAttribute('enterkeyhint') || 'default';
            return `${id} (${hint})`;
        });
        console.log(`📋 Navigation order: ${fieldNames.join(' → ')}`);
    }

    /**
     * Remove navigation setup from fields
     * @param {Array<string>} fieldIds - Array of field IDs
     */
    function remove(fieldIds) {
        if (!fieldIds || !Array.isArray(fieldIds)) {
            return;
        }

        fieldIds.forEach(id => {
            const field = document.getElementById(id);
            if (field) {
                delete field.dataset.navSetup;
                // Remove enterkeyhint
                field.removeAttribute('enterkeyhint');
            }
        });
    }

    /**
     * Get current navigation order
     * @param {Array<string>} fieldIds - Array of field IDs
     * @returns {Array} - Array of field elements in current order
     */
    function getOrder(fieldIds) {
        if (!fieldIds || !Array.isArray(fieldIds)) {
            return [];
        }
        return fieldIds
            .map(id => document.getElementById(id))
            .filter(el => el !== null);
    }

    /**
     * Update enterkeyhint for all fields
     * @param {Array<string>} fieldIds - Array of field IDs
     */
    function updateEnterKeyHints(fieldIds) {
        if (!fieldIds || !Array.isArray(fieldIds)) {
            return;
        }

        const fields = fieldIds
            .map(id => document.getElementById(id))
            .filter(el => el !== null);

        fields.forEach((field, index) => {
            const isLast = (index === fields.length - 1);
            field.setAttribute('enterkeyhint', isLast ? 'done' : 'next');
        });
    }

    // Public API
    return {
        setup: setup,
        remove: remove,
        getOrder: getOrder,
        updateEnterKeyHints: updateEnterKeyHints
    };

})();

// ============================================================
// EXPORT (for module usage)
// ============================================================

// For <script> tag usage - global
if (typeof window !== 'undefined') {
    window.H4FormNavigation = H4FormNavigation;
}

// For ES module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = H4FormNavigation;
}

// ============================================================
// AUTO-DETECT AND SETUP
// ============================================================

// If the page has a product modal, auto-setup with correct IDs
// This runs when the script loads
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        // Check if we're on a product page
        const productModal = document.getElementById('productModal');
        if (productModal) {
            // Check if product fields exist
            const hasProductFields = document.getElementById('productCode') !== null;
            if (hasProductFields) {
                // Setup navigation with correct field IDs
                const fieldIds = [
                    'productCode',
                    'productName',
                    'productCategory',
                    'productBrand',
                    'productDescription',
                    'productUnit',
                    'productHsn',
                    'productGstRate',
                    'productStatus',
                    'productSellingRate',
                    'productPurchaseCost',
                    'productDealerPrice',
                    'productContractorPrice',
                    'productMrp',
                    'productOpeningStock',
                    'productCurrentStock',
                    'productMinStock'
                ];

                // Check if we should auto-setup
                if (typeof H4FormNavigation !== 'undefined' && H4FormNavigation.setup) {
                    // Check if any field already has navSetup
                    let alreadySetup = false;
                    for (const id of fieldIds) {
                        const el = document.getElementById(id);
                        if (el && el.dataset.navSetup === 'true') {
                            alreadySetup = true;
                            break;
                        }
                    }
                    
                    if (!alreadySetup) {
                        H4FormNavigation.setup(fieldIds);
                        console.log('📋 H4FormNavigation: Auto-setup for Product Master');
                    }
                }
            }
        }
    });
}

// ============================================================
// USAGE DOCUMENTATION
// ============================================================
// 
// To use in your HTML:
// 
// <script src="./js/form-navigation.js"></script>
// <script>
//     H4FormNavigation.setup([
//         'field1',
//         'field2',
//         'field3'
//     ]);
// </script>
// 
// ============================================================
// ID REFERENCE FOR PRODUCT MASTER
// ============================================================
// 
// Field Order                | ID                    | enterkeyhint
// ---------------------------|-----------------------|---------------
// 1. Product Code            | productCode           | next
// 2. Product Name            | productName           | next
// 3. Category                | productCategory       | next
// 4. Brand                   | productBrand          | next
// 5. Description             | productDescription    | next (textarea)
// 6. Unit                    | productUnit           | next (select)
// 7. HSN/SAC                 | productHsn            | next
// 8. GST Rate                | productGstRate        | next (select)
// 9. Status                  | productStatus         | next (select)
// 10. Selling Price          | productSellingRate    | next
// 11. Purchase Cost          | productPurchaseCost   | next
// 12. Dealer Price           | productDealerPrice    | next
// 13. Contractor Price       | productContractorPrice| next
// 14. MRP                    | productMrp            | next
// 15. Opening Stock          | productOpeningStock   | next
// 16. Current Stock          | productCurrentStock   | next
// 17. Minimum Stock          | productMinStock       | done
// 18. Save                   | modalSave             | (button)
// 
// ============================================================
// DESCRIPTION TEXTAREA BEHAVIOR
// ============================================================
// 
// - Enter key → moves to next field (Unit)
// - Shift+Enter → new line (natural textarea behavior)
// - Android keyboard shows "Next" button
// 
// ============================================================