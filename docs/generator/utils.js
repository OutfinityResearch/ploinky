const { GLOBAL_CONFIG } = require('./config.js');

function getPromoBanner(category) {
    if (!GLOBAL_CONFIG.promotionalBanner || !GLOBAL_CONFIG.promotionalBanner.enabled) {
        return null;
    }
    
    const banner = GLOBAL_CONFIG.promotionalBanner;
    const custom = banner.customBanners && banner.customBanners[category];
    
    if (custom) {
        return {
            text: custom.text || banner.defaultText,
            url: custom.url || banner.defaultUrl
        };
    }
    
    return {
        text: banner.defaultText,
        url: banner.defaultUrl
    };
}

module.exports = {
    getPromoBanner
};