export class ShowErrorModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.invalidate();
    }

    beforeRender() {
        this.title = this.element.getAttribute("data-title");
        this.message = this.element.getAttribute("data-message");
        this.technical = this.element.getAttribute("data-technical");
    }

    afterRender() {
        const titleElement = this.element.querySelector("[data-id='title']");
        const messageElement = this.element.querySelector("[data-id='message']");
        
        titleElement.textContent = this.title;
        messageElement.textContent = this.message;
        this.element.querySelector("[data-id='technical']").textContent = this.technical;

        try {
            const ws = window.webSkel;
            if (ws && ws.textService && typeof ws.textService.adjustFontSize === 'function') {
                ws.textService.adjustFontSize(titleElement);
                ws.textService.adjustFontSize(messageElement);
            }
        } catch (_) {
            // Ignore optional text sizing errors
        }
    }

    closeModal() {
        const modal = this.element.closest("dialog");
        if (modal) {
            modal.close();
            modal.remove();
        }
    }
}
