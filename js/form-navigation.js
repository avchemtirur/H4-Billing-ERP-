(function () {
    'use strict';

    function setupFormNavigation(fieldIds) {

        fieldIds.forEach((id, index) => {

            const field = document.getElementById(id);

            if (!field) return;

            field.setAttribute(
                'enterkeyhint',
                index === fieldIds.length - 1 ? 'done' : 'next'
            );

            field.addEventListener('keydown', function (e) {

                if (e.key !== 'Enter') return;

                // Description textarea: Enter = new line
                if (field.tagName === 'TEXTAREA') return;

                e.preventDefault();

                const nextId = fieldIds[index + 1];

                if (nextId) {
                    const nextField =
                        document.getElementById(nextId);

                    if (nextField) {
                        nextField.focus();
                    }
                } else {
                    const saveButton =
                        document.getElementById('modalSave');

                    if (saveButton) {
                        saveButton.click();
                    }
                }
            });
        });
    }

    window.H4FormNavigation = {
        setup: setupFormNavigation
    };

})();