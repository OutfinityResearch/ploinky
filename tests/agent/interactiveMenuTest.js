const reblessed = require('reblessed');
const { createInteractiveMenu } = require('../../Agent/AgentUtil.js');

/**
 * This function runs a standalone test for the createInteractiveMenu component.
 */
async function runTest() {
    // 1. Create a reblessed screen instance
    const screen = reblessed.screen({
        smartCSR: true,
        title: 'Interactive Menu Test',
        fullUnicode: true,
    });

    // 2. Define some sample items for the list
    const sampleItems = [
        { name: 'First Option', value: 'option1', description: 'A great choice.' },
        { name: 'Second Option', value: 'option2', description: 'Another excellent choice.' },
        { name: 'A Third, Longer Option', value: 'option3', description: 'This one is also good.' },
        { name: 'Fourth Item', value: 'option4', description: 'A classic.' },
        { name: 'Fifth Item', value: 'option5', description: 'A fan favorite.' },
    ];

    // 3. Call the menu function and wait for the user's selection
    // The console will clear and the menu will appear.
    const selectedItem = await createInteractiveMenu({
        title: 'Test Menu: Select an Item',
        items: sampleItems,
        formatItem: (item) => `${item.name} {grey-fg}(${item.description}){/}`,
        screen: screen,
    });

    // 4. Clean up the reblessed screen to return to the normal terminal
    screen.destroy();

    // 5. Log the result to the console
    console.log('\n--- Test Complete ---');
    if (selectedItem) {
        console.log('You selected:', JSON.stringify(selectedItem, null, 2));
    } else {
        console.log('Menu was cancelled (you pressed ESC).');
    }
    console.log('---------------------\n');
    process.exit(0);
}

runTest().catch(console.error);