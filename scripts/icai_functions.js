// Functions for handling ICAI Review Questions

async function loadICAIQuestions() {
    try {
        const response = await fetch('data/icai_review.json');
        const data = await response.json();
        appState.icaiData = data;
        return data;
    } catch (error) {
        console.error('Error loading ICAI questions:', error);
        return null;
    }
}

function getICAIQuestionsByModule(moduleNum, count) {
    if (!appState.icaiData) return [];
    
    const moduleQuestions = appState.icaiData.questions.filter(q => q.module === moduleNum);
    if (count === 'all') return moduleQuestions;
    return shuffle(moduleQuestions).slice(0, count);
}

function getProportionalICAIQuestions(count) {
    if (!appState.icaiData) return [];
    
    const totalQuestions = [];
    const moduleStats = appState.icaiData.metadata.modules;
    
    // Calculate questions per module proportionally
    Object.keys(moduleStats).forEach(moduleNum => {
        const moduleCount = Math.round((moduleStats[moduleNum].total_questions / appState.icaiData.metadata.total_questions) * count);
        if (moduleCount > 0) {
            const moduleQuestions = getICAIQuestionsByModule(parseInt(moduleNum), moduleCount);
            totalQuestions.push(...moduleQuestions);
        }
    });
    
    // Ensure we have exactly the requested number of questions
    if (totalQuestions.length > count) {
        return shuffle(totalQuestions).slice(0, count);
    } else if (totalQuestions.length < count) {
        // Add more questions randomly if we're short
        const remaining = count - totalQuestions.length;
        const additionalQuestions = shuffle(appState.icaiData.questions)
            .filter(q => !totalQuestions.includes(q))
            .slice(0, remaining);
        totalQuestions.push(...additionalQuestions);
    }
    
    return shuffle(totalQuestions);
}

async function startICAISession(moduleNum = null) {
    // Load ICAI questions if not already loaded
    if (!appState.icaiData) {
        const data = await loadICAIQuestions();
        if (!data) {
            alert('Failed to load ICAI Review questions. Please try again.');
            return;
        }
    }
    
    const count = parseInt(document.getElementById('icai-count').value, 10) || 25;
    
    // Get questions based on selection
    let questions;
    if (moduleNum) {
        // Module-specific questions
        questions = getICAIQuestionsByModule(moduleNum, count);
    } else {
        // Proportional selection from all modules
        questions = getProportionalICAIQuestions(count);
    }
    
    // Setup quiz state
    appState.currentModule = 'icai';
    appState.questions = questions;
    appState.currentIndex = 0;
    appState.correct = 0;
    appState.sessionSize = questions.length;
    appState.timeLeft = calculateTimeForQuestions(questions.length);
    
    // Update UI
    $('#module-selection').classList.add('hide');
    $('#quiz-container').classList.remove('hide');
    $('#module-name').textContent = moduleNum ? 
        `ISA Review - Module ${moduleNum}` : 'ISA Review - Mixed';
    $('#total-questions').textContent = questions.length;
    $('#total-questions-2').textContent = questions.length;
    $('#correct-score').textContent = '0';
    $('#current-question').textContent = '1';
    
    updateProgressBar();
    renderQuestion();
    startTimer();
}