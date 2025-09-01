// Test script to verify gradient selection logic
function testGradientSelection() {
    // Simulate the gradient selection logic
    const totalGradients = 30;
    const lastUsedGradients = [];
    
    console.log('Testing gradient selection for 20 consecutive cards:');
    
    for (let i = 0; i < 20; i++) {
        const id = `post-${i}`;
        let hash = 0; 
        for (let j = 0; j < id.length; j++) {
            hash = ((hash << 5) - hash) + id.charCodeAt(j);
        }
        
        // Calculate base gradient number from hash
        let gradientNumber = (Math.abs(hash) % totalGradients) + 1;
        
        // Ensure this gradient is different from the last few used
        const recentGradients = lastUsedGradients.slice(-3);
        let attempts = 0;
        const maxAttempts = 10;
        
        while (recentGradients.includes(gradientNumber) && attempts < maxAttempts) {
            // Try a different gradient
            gradientNumber = ((gradientNumber + Math.floor(Math.random() * 5) + 1) % totalGradients) + 1;
            attempts++;
        }
        
        // Store this gradient in history
        lastUsedGradients.push(gradientNumber);
        // Keep only last 5 gradients in history
        if (lastUsedGradients.length > 5) {
            lastUsedGradients.shift();
        }
        
        console.log(`Card ${i}: Gradient ${gradientNumber}, Recent: [${recentGradients.join(', ')}]`);
        
        // Check if adjacent cards have the same gradient
        if (i > 0 && gradientNumber === lastUsedGradients[lastUsedGradients.length - 2]) {
            console.warn(`⚠️  Adjacent cards have same gradient: ${gradientNumber}`);
        }
    }
    
    console.log('Test completed.');
}

testGradientSelection();