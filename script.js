// Calculate time based on question count (72 seconds per question)
function calculateTimeForQuestions(count) {
    return count * 72; // 72 seconds per question (2 hours for 100 questions)
}

const modulesData = {
    "module1": {
        name: "Module 1",
        questions: [] // Questions will be populated from mcqs.js
    },
    "module2": {
        name: "Module 2",
        questions: [] // Questions will be populated from module2.js
    },
    "module3": {
        name: "Module 3",
        questions: [] // Questions will be populated from module3.js
    },
    "module4": {
        name: "Module 4",
        questions: [] // Questions will be populated from module4.js
    },
    "module5": {
        name: "Module 5",
        questions: [] // Questions will be populated from module5.js
    },
    "module6": {
        name: "Module 6",
        questions: [] // Questions will be populated from module6.js
    }
};

// Helper: load questions from JSON file
async function loadModuleQuestions(moduleId) {
    try {
        // Clear any stale cache
        const cacheKey = `module${moduleId}Cache`;
        localStorage.removeItem(cacheKey);
        let data = null;
        
        // Get base path from current URL
        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        console.log('Base path:', basePath);

        // Determine all possible paths to try
        const paths = [
            // Try absolute paths first
            `/data/module${moduleId}.json`,
            // Then current directory relative
            `${basePath}data/module${moduleId}.json`,
            `${basePath}module${moduleId}.json`,
            // Then local relative paths
            `./data/module${moduleId}.json`,
            `data/module${moduleId}.json`,
            `module${moduleId}.json`,
            // Fallback to root-relative with base
            `/module${moduleId}.json`,
            `${basePath.replace(/[^/]+\/$/, '')}data/module${moduleId}.json`
        ].filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates
        
        console.log('Trying paths:', paths);  // Debug logging

        let response;
        for (const path of paths) {
            try {
                console.log('Attempting to load from:', path);
                response = await fetch(path);
                if (response.ok) {
                    console.log('Successfully loaded from:', path);
                    break;
                } else {
                    console.log(`Failed to load from ${path} with status:`, response.status);
                }
            } catch (e) {
                console.log(`Error loading from ${path}:`, e.message);
            }
        }

        if (!response || !response.ok) {
            throw new Error('Failed to load questions from any path');
        }

        data = await response.json();
        
        // Cache the loaded data
        try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to cache module data:', e);
        }

        if (!data || !data.questions || !data.questions.length) {
            throw new Error('Invalid module data');
        }

        console.log(`Loading ${data.questions.length} questions into module${moduleId}...`);
        // Sort questions by ID to ensure consistent order
        data.questions.sort((a,b) => a.id - b.id);
        modulesData[`module${moduleId}`].questions = data.questions;
        
        // Update display to show correct question count
        document.querySelectorAll(`#module${moduleId}-progress`).forEach(el => {
            el.textContent = `0/${data.questions.length} questions attempted`;
        });
        document.querySelectorAll('.module-card').forEach(el => {
            const heading = el.querySelector('h2');
            if (heading && heading.textContent === `Module ${moduleId}`) {
                const questionsP = el.querySelector('p');
                if (questionsP && questionsP.textContent.includes('Questions')) {
                    questionsP.textContent = `${data.questions.length} Questions`;
                }
            }
        });
        
        if (typeof updateModuleProgress === 'function') updateModuleProgress();
        console.log('Questions loaded successfully');
        return true;
    } catch (e) {
        console.error('Error loading questions:', e);
        // Show a more helpful error message
        alert('Error loading questions. If running directly from file, please use a web server (e.g., Live Server in VS Code)');
        return false;
    }
}

// --- Application logic: quiz lifecycle and UI handlers ---

let appState = {
    currentModule: null,
    questions: [],
    currentIndex: 0,
    correct: 0,
    timerId: null,
    timeLeft: 0,
    sessionSize: 0,
    icaiData: null,  // Will store the ICAI review questions data
    analytics: {
        startTime: null,
        questionTimes: [],
        averageTime: 0,
        accuracy: 0
    }
};

// Helper functions for DOM manipulation
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

// Get all saved sessions from localStorage
function getSavedSessions() {
    const sessions = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('quizProgress_')) {
            try {
                const saved = JSON.parse(localStorage.getItem(key));
                sessions[saved.module] = saved;
            } catch (e) {
                console.warn('Invalid session data:', key);
            }
        }
    }
    return sessions;
}

function startModuleSession(moduleKey, resume=false) {
    console.log('Starting module session:', moduleKey, resume);
    const module = modulesData[moduleKey];
    if (!module || !module.questions || module.questions.length === 0) {
        alert('Questions not loaded yet. Please wait a moment and try again.');
        return;
    }
    if (resume) {
        // attempt to resume saved session for this module
        resumeModule(moduleKey);
        return;
    }
    
    // If starting new session, clear any existing session for this module
    localStorage.removeItem(`quizProgress_${moduleKey}`);
    console.log(`Cleared existing session for ${moduleKey}`);
    
    // determine count selection
    const select = document.getElementById(moduleKey + '-count');
    let count = select ? select.value : 'all';
    if (count === 'all') count = module.questions.length;
    else count = parseInt(count, 10) || module.questions.length;

    appState.currentModule = moduleKey;
    appState.questions = shuffle(module.questions).slice(0, count);
    appState.currentIndex = 0;
    appState.correct = 0;
    appState.sessionSize = appState.questions.length;
    appState.timeLeft = calculateTimeForQuestions(appState.sessionSize);

    // show quiz UI
    $('#module-selection').classList.add('hide');
    $('#quiz-container').classList.remove('hide');
    $('#module-name').textContent = module.name;
    $('#total-questions').textContent = appState.sessionSize;
    $('#total-questions-2').textContent = appState.sessionSize;
    $('#correct-score').textContent = appState.correct;
    $('#current-question').textContent = appState.currentIndex + 1;

    renderQuestion();
    startTimer();
}

function getProportionalQuestions(totalCount) {
    const moduleQuestions = [];
    const availableModules = Object.keys(modulesData).filter(k => 
        modulesData[k].questions && modulesData[k].questions.length > 0
    );
    
    if (availableModules.length === 0) return [];

    // Calculate questions per module (roughly equal distribution)
    const questionsPerModule = Math.floor(totalCount / availableModules.length);
    let remaining = totalCount;

    // First pass: get equal numbers from each module
    availableModules.forEach(moduleKey => {
        const questions = shuffle(modulesData[moduleKey].questions)
            .slice(0, questionsPerModule)
            .map(q => ({...q, sourceModule: moduleKey})); // Track source module
        moduleQuestions.push(...questions);
        remaining -= questions.length;
    });

    // Second pass: distribute remaining questions
    if (remaining > 0) {
        const extraQuestions = availableModules.flatMap(moduleKey => 
            shuffle(modulesData[moduleKey].questions)
                .slice(questionsPerModule)
                .map(q => ({...q, sourceModule: moduleKey}))
        );
        moduleQuestions.push(...shuffle(extraQuestions).slice(0, remaining));
    }

    return shuffle(moduleQuestions);
}

function startMixedSession(resume=false) {
    // Check if modules are loaded
    const hasLoadedModules = Object.keys(modulesData).some(k => 
        modulesData[k].questions && modulesData[k].questions.length > 0
    );
    if (!hasLoadedModules) { 
        alert('No questions available yet. Please wait for modules to load.'); 
        return; 
    }
    
    if (resume) {
        resumeMixed();
        return;
    }
    
    // If starting new session, clear any existing mixed session
    localStorage.removeItem('quizProgress_mixed');
    console.log('Cleared existing mixed session');
    
    const count = parseInt(document.getElementById('mixed-count').value, 10) || 25;
    appState.currentModule = 'mixed';
    appState.questions = getProportionalQuestions(count);
    appState.currentIndex = 0;
    appState.correct = 0;
    appState.sessionSize = appState.questions.length;
    appState.timeLeft = calculateTimeForQuestions(appState.sessionSize);

    $('#module-selection').classList.add('hide');
    $('#quiz-container').classList.remove('hide');
    $('#module-name').textContent = 'Mixed';
    $('#total-questions').textContent = appState.sessionSize;
    $('#total-questions-2').textContent = appState.sessionSize;
    $('#correct-score').textContent = appState.correct;
    $('#current-question').textContent = appState.currentIndex + 1;
    
    // Show progress bar
    updateProgressBar();

    renderQuestion();
    startTimer();
}

function renderQuestion() {
    const q = appState.questions[appState.currentIndex];
    if (!q) return;
    // show sequential question number in the session (1..N), no original ID shown
    $('#question').textContent = `${appState.currentIndex + 1}. ${q.question}`;
    const opts = $all('.option');
    
    // Helper function to normalize options
    const normalizeOptions = (q) => {
        let options = [];
        
        // First try standard options array
        if (Array.isArray(q.options)) {
            options = q.options;
        }
        // Then try numbered options (option1, option2, etc.)
        else if (!options.length) {
            for (let i = 1; i <= 4; i++) {
                const opt = q[`option${i}`];
                if (opt) {
                    options.push(typeof opt === 'string' ? { id: `option${i}`, text: opt } : opt);
                }
            }
        }
        // Finally try lettered options (A, B, C, D)
        if (!options.length) {
            ['A', 'B', 'C', 'D'].forEach((letter, i) => {
                const opt = q[letter];
                if (opt) {
                    options.push(typeof opt === 'string' ? { id: letter, text: opt } : opt);
                }
            });
        }

        // Normalize each option to have id and text
        options = options.map((opt, idx) => {
            if (typeof opt === 'string') {
                return { id: `option${idx + 1}`, text: opt };
            } else if (opt && typeof opt === 'object') {
                return { 
                    id: opt.id || `option${idx + 1}`,
                    text: opt.text || opt.value || `Option ${idx + 1}`
                };
            }
            return { id: `option${idx + 1}`, text: `Option ${idx + 1}` };
        });

        // Ensure exactly 4 options
        while (options.length < 4) {
            options.push({ 
                id: `option${options.length + 1}`, 
                text: `Option ${options.length + 1}` 
            });
        }

        // Limit to 4 options if more exist
        return options.slice(0, 4);
    };

    let options = normalizeOptions(q);

    opts.forEach((btn, idx) => {
        btn.classList.remove('correct', 'wrong');
        btn.disabled = false;
        const option = options[idx];
        
        // Handle different option formats
        let optionText = '';
        if (typeof option === 'string') {
            optionText = option;
        } else if (option && typeof option === 'object') {
            optionText = option.text || option.value || '';
        }
        
        btn.textContent = optionText;
        // Store the option ID if it exists for later reference
        if (option && option.id) {
            btn.dataset.optionId = option.id;
        }
    });
    $('#explanation').classList.add('hide');
    $('#current-question').textContent = appState.currentIndex + 1;
    $('#correct-score').textContent = appState.correct;

    // If this question was already answered in this session, reflect that state
    if (q.userAnswer !== undefined && q.userAnswer !== null) {
        opts.forEach(b => b.disabled = true);
        opts[q.userAnswer] && opts[q.userAnswer].classList.add(q.userAnswer === q.answerIndex ? 'correct' : 'wrong');
        if (typeof q.answerIndex === 'number' && q.userAnswer !== q.answerIndex) {
            opts[q.answerIndex] && opts[q.answerIndex].classList.add('correct');
        }
        const expl = q.explanation || '';
        if (expl) {
            const el = $('#explanation');
            el.innerHTML = `<strong>Explanation:</strong> ${escapeHtml(expl)}`;
            el.classList.remove('hide');
        }
    }
}

function checkAnswer(idx) {
    const q = appState.questions[appState.currentIndex];
    if (!q) return;
    // Prevent changing answer once set
    if (q.userAnswer !== undefined && q.userAnswer !== null) return;
    
    // Record time spent on question
    const now = Date.now();
    if (appState.analytics.startTime) {
        const timeSpent = (now - appState.analytics.startTime) / 1000; // convert to seconds
        appState.analytics.questionTimes.push(timeSpent);
        
        // Update average time
        const sum = appState.analytics.questionTimes.reduce((a, b) => a + b, 0);
        appState.analytics.averageTime = sum / appState.analytics.questionTimes.length;
    }
    appState.analytics.startTime = now;
    
    const opts = $all('.option');
    opts.forEach(b => b.disabled = true);
    q.userAnswer = idx;
    
    // For both module questions and ICAI questions
    const correctAnswerIndex = q.answer !== undefined ? 
        (typeof q.answer === 'number' ? q.answer : // Direct index
        q.options.findIndex(opt => opt.id === q.answer)) : // ICAI format
        q.answerIndex; // Module format
    
    if (idx === correctAnswerIndex) {
        opts[idx].classList.add('correct');
        appState.correct++;
    } else {
        opts[idx].classList.add('wrong');
        // Highlight correct answer
        if (correctAnswerIndex >= 0) {
            opts[correctAnswerIndex].classList.add('correct');
        }
    }
    
    // Store correct index for later use
    q.answerIndex = correctAnswerIndex;
    
    // recompute correct count and accuracy
    appState.correct = appState.questions.reduce((acc, qq) =>
        acc + ((qq.userAnswer !== undefined && qq.userAnswer === qq.answerIndex) ? 1 : 0)
    , 0);
    
    const attempted = appState.questions.filter(q => q.userAnswer !== undefined).length;
    appState.analytics.accuracy = (appState.correct / attempted) * 100;
    
    // Save progress after each answer
    saveProgressDirect();

    // Show explanation for both module and ICAI questions
    const expl = (typeof q.explanation === 'object' ? q.explanation.text : q.explanation) || '';
    if (expl) {
        const el = $('#explanation');
        el.innerHTML = `<strong>Explanation:</strong> ${escapeHtml(expl)}`;
        el.classList.remove('hide');
    }
    $('#correct-score').textContent = appState.correct;
}

function nextQuestion() {
    if (appState.currentIndex + 1 >= appState.sessionSize) {
        finishQuiz();
        return;
    }
    appState.currentIndex++;
    renderQuestion();
}

function finishQuiz() {
    clearInterval(appState.timerId);
    $('#quiz-container').classList.add('hide');
    $('#result').classList.remove('hide');
    $('#final-score').textContent = appState.correct;
    $('#total-score').textContent = appState.sessionSize;
    
    // Calculate actual statistics
    const attempted = appState.questions.filter(q => q.userAnswer !== undefined).length;
    const skipped = appState.sessionSize - attempted;
    const accuracy = attempted > 0 ? (appState.correct / attempted) * 100 : 0;
    const totalAccuracy = (appState.correct / appState.sessionSize) * 100;
    const passed = totalAccuracy >= 60; // 60% threshold
    
    // Add analytics summary
    const analyticsSummary = document.createElement('div');
    analyticsSummary.className = 'analytics-summary';
    analyticsSummary.innerHTML = `
        <h3>Performance Summary</h3>
        <div class="result-status ${passed ? 'pass' : 'fail'}">
            ${passed ? 'PASSED' : 'FAILED'} (Minimum 60% required)
        </div>
        <p>Questions Attempted: ${attempted} of ${appState.sessionSize}</p>
        <p>Questions Skipped: ${skipped}</p>
        <p>Correct Answers: ${appState.correct}</p>
        <p>Accuracy (of attempted): ${accuracy.toFixed(1)}%</p>
        <p>Overall Score: ${totalAccuracy.toFixed(1)}%</p>
        <p>Average time per question: ${appState.analytics.averageTime.toFixed(1)} seconds</p>
        <div class="performance-chart">
            <div class="chart-bar" style="width: ${totalAccuracy}%"></div>
        </div>
    `;
    $('#result').insertBefore(analyticsSummary, $('#incorrect-answers'));
    
    // List incorrect answers and skipped questions
    const container = $('#incorrect-answers');
    container.innerHTML = '<h3>Review Questions</h3>';
    
    // Show incorrect answers
    appState.questions.forEach((q, i) => {
        if (q.userAnswer === undefined || q.userAnswer !== q.answerIndex) {
            const div = document.createElement('div');
            div.className = 'incorrect-item';
            // Handle both module and ICAI format questions
            const userAnswerText = q.userAnswer !== undefined ? 
                (Array.isArray(q.options) ? 
                    (typeof q.options[q.userAnswer] === 'string' ? q.options[q.userAnswer] : q.options[q.userAnswer].text) : 
                    'undefined') : 
                'Question was skipped';
            
            const getCorrectAnswer = () => {
                if (!Array.isArray(q.options)) return 'undefined';
                
                // For ICAI format with ID-based answers
                if (typeof q.answer === 'string' && q.options[0] && 'id' in q.options[0]) {
                    const correctOption = q.options.find(opt => opt.id === q.answer);
                    return correctOption?.text || 'undefined';
                }
                
                // For module format or direct index answers
                const index = typeof q.answer === 'number' ? q.answer : q.answerIndex;
                if (typeof index === 'number' && index >= 0 && index < q.options.length) {
                    const option = q.options[index];
                    return typeof option === 'string' ? option : option?.text || 'undefined';
                }
                
                return 'undefined';
            };
            const correctAnswerText = getCorrectAnswer();
            
            div.innerHTML = `
                <p class="question">${i + 1}. ${q.question}</p>
                ${q.userAnswer !== undefined ? 
                    `<p class="wrong">Your answer: ${userAnswerText}</p>` :
                    '<p class="skipped">Question was skipped</p>'}
                <p class="correct">Correct answer: ${correctAnswerText}</p>
                ${q.explanation ? 
                    `<p class="explanation"><strong>Explanation:</strong> ${typeof q.explanation === 'object' ? q.explanation.text : q.explanation}</p>` : 
                    ''}
            `;
            container.appendChild(div);
        }
    });
}

function restartQuiz() {
    $('#result').classList.add('hide');
    $('#module-selection').classList.remove('hide');
}

function saveAndReturn() {
    // save current session to localStorage so user can resume later
    try {
        // Only save if we've answered at least one question
        if (appState.currentIndex > 0) {
            const snapshot = {
                module: appState.currentModule,
                currentIndex: appState.currentIndex,
                correct: appState.correct,
                timeLeft: appState.timeLeft,
                sessionSize: appState.sessionSize,
                questions: appState.questions,
                timestamp: Date.now()
            };
            // Save to single progress key
            localStorage.setItem('quizProgress', JSON.stringify(snapshot));
            console.log('Progress saved:', snapshot);
        } else {
            console.log('No progress to save (no questions answered)');
        }
    } catch (e) {
        console.error('Failed to save progress:', e);
    }
    clearInterval(appState.timerId);
    $('#quiz-container').classList.add('hide');
    $('#module-selection').classList.remove('hide');
    updateAllProgress();
}

function updateAllProgress() {
    // Reset all progress displays first
    Object.keys(modulesData).forEach(moduleKey => {
        const progressEl = document.getElementById(`${moduleKey}-progress`);
        if (progressEl && modulesData[moduleKey] && modulesData[moduleKey].questions) {
            progressEl.textContent = `0/${modulesData[moduleKey].questions.length} questions attempted`;
        }
    });
    
    // Reset mixed progress
    const mixedProgressEl = document.getElementById('mixed-progress');
    if (mixedProgressEl) {
        const count = parseInt(document.getElementById('mixed-count').value, 10) || 25;
        mixedProgressEl.textContent = `0/${count} questions attempted`;
    }

    // Update based on current session if exists
    try {
        const savedProgress = localStorage.getItem('quizProgress');
        if (savedProgress) {
            const saved = JSON.parse(savedProgress);
            const moduleKey = saved.module;
            const progressEl = document.getElementById(`${moduleKey}-progress`);
            if (progressEl && saved.questions) {
                // Count actually attempted questions (those with userAnswer)
                const attempted = saved.questions.filter(q => q.userAnswer !== undefined).length;
                progressEl.textContent = `${attempted}/${saved.sessionSize} questions attempted`;
            }
            // Special handling for ICAI progress
            const icaiProgressEl = document.getElementById('icai-progress');
            if (icaiProgressEl && moduleKey === 'icai') {
                const count = parseInt(document.getElementById('icai-count').value, 10) || 25;
                icaiProgressEl.textContent = `${attempted}/${count} questions attempted`;
            }
        }
    } catch (e) {
        console.error('Error updating progress:', e);
    }

    // Update resume button visibility
    const resumeBtn = document.getElementById('resume-last');
    if (resumeBtn) {
        const hasProgress = !!localStorage.getItem('quizProgress');
        resumeBtn.classList.toggle('hide', !hasProgress);
    }
}

function startTimer() {
    clearInterval(appState.timerId);
    const el = $('#timer');
    function tick() {
        if (appState.timeLeft <= 0) { finishQuiz(); return; }
        appState.timeLeft--;
        el.textContent = formatSeconds(appState.timeLeft);
    }
    el.textContent = formatSeconds(appState.timeLeft);
    appState.timerId = setInterval(tick, 1000);
}

function formatSeconds(sec) {
    const h = Math.floor(sec / 3600).toString().padStart(2,'0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2,'0');
    const s = (sec % 60).toString().padStart(2,'0');
    return `${h}:${m}:${s}`;
}

function updateProgressBar() {
    const progressBar = $('#progress-bar');
    if (!progressBar) return;
    
    // Calculate progress percentage
    const progress = (appState.currentIndex / appState.sessionSize) * 100;
    progressBar.style.width = `${progress}%`;
    
    // Update color based on performance
    if (appState.currentIndex > 0) {
        const accuracy = (appState.correct / appState.currentIndex) * 100;
        if (accuracy >= 80) progressBar.style.backgroundColor = '#4CAF50';  // Green
        else if (accuracy >= 60) progressBar.style.backgroundColor = '#FFC107';  // Yellow
        else progressBar.style.backgroundColor = '#f44336';  // Red
    }
}

function updateMixedTime() {
    const count = parseInt(document.getElementById('mixed-count').value, 10);
    const timeEl = document.getElementById('mixed-time');
    if (timeEl) {
        if (count === 25) timeEl.textContent = '30 mins';
        else if (count === 50) timeEl.textContent = '1 hour';
        else if (count === 100) timeEl.textContent = '2 hours';
    }
}

function getSelectedModuleQuestions() {
    if (!appState.icaiData || !appState.icaiData.questions) return [];
    const moduleNum = parseInt(document.getElementById('icai-module').value, 10);
    if (moduleNum === 0) return appState.icaiData.questions; // All modules
    return appState.icaiData.questions.filter(q => q.module === moduleNum);
}

function updateICAIQuestions() {
    const questions = getSelectedModuleQuestions();
    const progressEl = document.getElementById('icai-progress');
    if (progressEl) {
        progressEl.textContent = `0/${questions.length} questions available`;
    }
    updateICAITime(); // Update time based on new question count
}

function updateICAITime() {
    console.log('Updating ICAI time...');
    const selectEl = document.getElementById('icai-count');
    if (!selectEl) return;

    const questions = getSelectedModuleQuestions();
    const maxQuestions = questions.length;
    
    // Get selected value
    const selectedValue = selectEl.value;
    console.log('Selected value:', selectedValue);
    
    // Calculate count
    const count = selectedValue === 'all' ? 
        maxQuestions : 
        Math.min(parseInt(selectedValue, 10) || 25, maxQuestions);
    console.log('Calculated count:', count);
    
    // Calculate time
    let timeText;
    if (count <= 25) timeText = '30 mins';
    else if (count <= 50) timeText = '1 hour';
    else if (count <= 100) timeText = '2 hours';
    else {
        const hours = Math.ceil(count * 72 / 3600); // 72 seconds per question
        timeText = `${hours} hour${hours > 1 ? 's' : ''}`;
    }
    
    // Update time display
    const timeEl = document.getElementById('icai-time');
    if (timeEl) {
        console.log('Updating time to:', timeText);
        timeEl.textContent = timeText;
    }
    
    // Update progress display
    const progressEl = document.getElementById('icai-progress');
    if (progressEl) {
        const text = `0/${maxQuestions} questions available`;
        console.log('Updating progress to:', text);
        progressEl.textContent = text;
    }
}

// Helper function to check if text is an explanation
function isExplanation(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return (
        lowerText.includes(' is incorrect') ||
        lowerText.includes(' is correct') ||
        lowerText.includes('explanation:') ||
        lowerText.includes('solution:') ||
        (text.match(/^\d+\.\s*[A-Z][^?]*$/) && !text.includes('?'))
    );
}

async function loadICAIReviewQuestions() {
    try {
        // Get base path from current URL
        const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        
        // Try various paths
        const paths = [
            '/data/icai_review.json',
            `${basePath}data/icai_review.json`,
            './data/icai_review.json',
            'data/icai_review.json'
        ];
        
        let response;
        for (const path of paths) {
            try {
                console.log('Attempting to load ICAI Review questions from:', path);
                response = await fetch(path);
                if (response.ok) {
                    console.log('Successfully loaded from:', path);
                    break;
                }
            } catch (e) {
                console.log(`Error loading from ${path}:`, e.message);
            }
        }
        
        // Normalize and validate options structure
        const normalizeOptions = (options) => {
            if (!Array.isArray(options)) return [];
            return options.map(opt => {
                if (typeof opt === 'string') {
                    return { id: `opt_${Math.random().toString(36).substr(2, 9)}`, text: opt };
                }
                if (typeof opt === 'object' && opt !== null) {
                    return {
                        id: opt.id || `opt_${Math.random().toString(36).substr(2, 9)}`,
                        text: opt.text || opt.value || ''
                    };
                }
                return null;
            }).filter(opt => opt !== null);
        };        if (!response || !response.ok) {
            throw new Error('Failed to load ICAI Review questions from any path');
        }

        const data = await response.json();
        if (!data || !data.questions || !data.questions.length) {
            throw new Error('Invalid ICAI Review data structure');
        }

        // Validate and normalize question format
        data.questions = data.questions.map((q, qIndex) => {
            // Skip if invalid or is an explanation
            if (!q || !q.question || isExplanation(q.question)) {
                console.log(`Skipping invalid or explanation entry at index ${qIndex}:`, q?.question);
                return null;
            }

            console.log(`Processing question ${qIndex + 1}:`, q.question);
            
            // Ensure question has options array
            if (!Array.isArray(q.options)) {
                console.warn(`Question ${qIndex + 1} has no options array:`, q);
                // Check if options exist as numbered properties
                const numberedOptions = {};
                for (let i = 0; i < 4; i++) {
                    const key = `option${i + 1}`;
                    if (q[key]) {
                        numberedOptions[key] = q[key];
                    }
                }
                
                if (Object.keys(numberedOptions).length > 0) {
                    console.log(`Found numbered options for question ${qIndex + 1}:`, numberedOptions);
                    q.options = Object.values(numberedOptions);
                } else {
                    q.options = [];
                }
            }

            // Normalize options to have consistent structure
            q.options = q.options.map((opt, idx) => {
                if (typeof opt === 'string') {
                    return {
                        id: `option${idx + 1}`,
                        text: opt
                    };
                } else if (typeof opt === 'object' && opt !== null) {
                    // Handle cases where the option might be nested
                    const text = opt.text || opt.value || (typeof opt.option === 'string' ? opt.option : null) || '';
                    return {
                        id: opt.id || `option${idx + 1}`,
                        text: text
                    };
                }
                return {
                    id: `option${idx + 1}`,
                    text: ''
                };
            });

            // Ensure exactly 4 options
            while (q.options.length < 4) {
                q.options.push({
                    id: `option${q.options.length + 1}`,
                    text: 'Option ' + (q.options.length + 1)  // Provide default text
                });
            }

            // Additional validation and filtering
            if (!q.answer && typeof q.correctAnswer !== 'undefined') {
                q.answer = q.correctAnswer;
            }

            // Skip entries that look like explanations rather than questions
            const isExplanation = q.question && (
                // Check for explanation markers
                q.question.toLowerCase().includes(' is incorrect') ||
                q.question.toLowerCase().includes(' is correct') ||
                q.question.toLowerCase().includes('explanation:') ||
                q.question.toLowerCase().includes('solution:') ||
                // Check for non-question format (no question mark, starts with number and letter)
                (q.question.match(/^\d+\.\s*[A-Z][^?]*$/) && !q.question.includes('?'))
            );

            // Skip if it looks like an explanation
            if (isExplanation) {
                console.log('Skipping explanation text:', q.question);
                return null;
            }

            return q;
        });

        // Filter out null entries and cache the normalized data
        data.questions = data.questions.filter(q => q !== null);
        appState.icaiData = data;
        console.log('Loaded and normalized ICAI questions:', data.questions.length);
        return data.questions;
    } catch (e) {
        console.error('Error loading ICAI Review questions:', e);
        alert('Error loading ICAI Review questions. Please check your connection and try again.');
        return null;
    }
}

async function startICAISession(resume=false) {
    try {
        if (resume) {
            resumeICAI();
            return;
        }
        
        // If starting new session, clear any existing ICAI session
        localStorage.removeItem('quizProgress_icai');
        console.log('Cleared existing ICAI session');
    
        // Debug: Print current ICAI data
        if (appState.icaiData && appState.icaiData.questions) {
            console.log('Current ICAI questions sample:', 
                appState.icaiData.questions.slice(0, 3).map(q => ({
                    question: q.question,
                    optionsCount: q.options?.length || 0,
                    optionsSample: q.options?.slice(0, 2) || []
                }))
            );
        }
        
        const countSelect = document.getElementById('icai-count');
        const selectedValue = countSelect.value;
        let count;
        
        // Handle "all" option
        if (selectedValue === 'all') {
            // Load ICAI questions if not already loaded
            if (!appState.icaiData) {
                const questions = await loadICAIReviewQuestions();
                if (!questions) return;  // Error occurred during loading
                appState.icaiData = { questions };
            }
            count = appState.icaiData.questions.length;
        } else {
            count = parseInt(selectedValue, 10) || 25;
        }
        
        // Load ICAI questions if not already loaded
        if (!appState.icaiData) {
            const questions = await loadICAIReviewQuestions();
            if (!questions) return;  // Error occurred during loading
            appState.icaiData = { questions };
        }
        
        // Initialize ICAI session
        // Get questions for selected module
        let moduleQuestions = getSelectedModuleQuestions();
        
        // Filter out questions with missing or invalid options
        const validQuestions = moduleQuestions.filter(q => {
            return q && q.options && Array.isArray(q.options) && q.options.length > 0 &&
                   q.options.every(opt => opt && (typeof opt === 'string' || (typeof opt === 'object' && opt.text)));
        });
        
        console.log('Valid ICAI questions for selected module:', validQuestions.length);
        
        if (validQuestions.length === 0) {
            throw new Error('No valid questions found with proper options for the selected module');
        }
        
        appState.currentModule = 'icai';
        // If 'all' is selected, use all valid questions, otherwise limit to count
        appState.questions = count === validQuestions.length ? 
            validQuestions : shuffle(validQuestions).slice(0, Math.min(count, validQuestions.length));
        appState.currentIndex = 0;
        appState.correct = 0;
        appState.sessionSize = count;    // Update display to show total questions available
    // Update time based on count
    appState.timeLeft = calculateTimeForQuestions(count);
    
    // Update progress display on the module selection screen
    const icaiProgressEl = document.getElementById('icai-progress');
    if (icaiProgressEl) {
        icaiProgressEl.textContent = `0/${validQuestions.length} questions available`;
    }        $('#module-selection').classList.add('hide');
        $('#quiz-container').classList.remove('hide');
        $('#module-name').textContent = 'ISA Review Questions by ICAI';
        $('#total-questions').textContent = count;
        $('#total-questions-2').textContent = count;
        $('#correct-score').textContent = appState.correct;
        $('#current-question').textContent = '1';
        
        // Show progress bar
        updateProgressBar();

        renderQuestion();
        startTimer();
    } catch (error) {
        console.error('Error starting ICAI session:', error);
        alert('Error starting ICAI session: ' + error.message);
        // Clean up if needed
        appState.currentModule = null;
        appState.questions = [];
        $('#quiz-container').classList.add('hide');
        $('#module-selection').classList.remove('hide');
    }
}

function resumeICAI() { resumeModule('icai'); }

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length -1; i>0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function escapeHtml(s) {
    return (s+'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

// Keyboard navigation handler
function handleKeyPress(e) {
    // Only handle keys when quiz is active
    if ($('#quiz-container').classList.contains('hide')) return;
    
    const currentQ = appState.questions[appState.currentIndex];
    
    // Next question on Enter/Space/Right Arrow (only if question is answered)
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && 
        currentQ && currentQ.userAnswer !== undefined) {
        e.preventDefault();
        nextQuestion();
    }
    
    // Answer selection with number keys 1-4
    if (['1','2','3','4'].includes(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const opts = $all('.option');
        if (opts[idx] && !opts[idx].disabled) {
            checkAnswer(idx);
        }
    }
}

// Show keyboard shortcuts help
function showKeyboardShortcuts() {
    const shortcuts = `
        Keyboard Shortcuts:
        • 1-4: Select answer
        • Enter/Space/Right Arrow: Next question
        • Esc: Return to modules
    `;
    alert(shortcuts);
}

// attach option buttons
document.addEventListener('DOMContentLoaded', () => {
    $all('.option').forEach((btn, idx) => btn.addEventListener('click', () => checkAnswer(idx)));
    
    // Add keyboard navigation
    document.addEventListener('keydown', handleKeyPress);
    
    // Add keyboard shortcuts help button
    const helpButton = document.createElement('button');
    helpButton.id = 'keyboard-help';
    helpButton.innerHTML = '⌨️ Shortcuts';
    helpButton.onclick = showKeyboardShortcuts;
    document.querySelector('.quiz-header').appendChild(helpButton);
    
    // wire resume/clear buttons
    const resumeBtn = document.getElementById('resume-last');
    if (resumeBtn) resumeBtn.addEventListener('click', () => resumeLast());
    const clearBtn = document.getElementById('clear-progress');
    if (clearBtn) clearBtn.addEventListener('click', () => { 
        // Clear quiz progress
        localStorage.removeItem('quizProgress');
        console.log('Cleared saved session');
        
        // Hide resume button
        const resumeBtn = document.getElementById('resume-last');
        if (resumeBtn) resumeBtn.classList.add('hide');
        
        // Reset all progress displays including mixed mode
        Object.keys(modulesData).forEach(moduleKey => {
            const progressEl = document.getElementById(`${moduleKey}-progress`);
            if (progressEl && modulesData[moduleKey] && modulesData[moduleKey].questions) {
                progressEl.textContent = `0/${modulesData[moduleKey].questions.length} questions attempted`;
            }
        });
        
        // Reset mixed progress specifically
        const mixedProgressEl = document.getElementById('mixed-progress');
        if (mixedProgressEl) {
            const count = parseInt(document.getElementById('mixed-count').value, 10) || 25;
            mixedProgressEl.textContent = `0/${count} questions attempted`;
        }
        
        // Reset ICAI progress specifically
        const icaiProgressEl = document.getElementById('icai-progress');
        if (icaiProgressEl) {
            const count = parseInt(document.getElementById('icai-count').value, 10) || 25;
            icaiProgressEl.textContent = `0/${count} questions attempted`;
        }
        
        alert('Progress cleared'); 
    });
    // module-specific resume buttons (in-module card)
    const module1Resume = document.getElementById('module1-resume');
    if (module1Resume) module1Resume.addEventListener('click', () => resumeModule('module1'));
    const module2Resume = document.getElementById('module2-resume');
    if (module2Resume) module2Resume.addEventListener('click', () => resumeModule('module2'));
    const mixedResume = document.getElementById('mixed-resume');
    if (mixedResume) mixedResume.addEventListener('click', () => resumeMixed());
    // try auto-load MCQs from global variable if present
    loadMCQSIfAvailable();
    // check for saved progress and update UI
    checkSavedProgress();
    // also listen for event when mcqs are loaded asynchronously
    window.addEventListener('mcqs:loaded', () => { loadMCQSIfAvailable(); checkSavedProgress(); });
});

function checkSavedProgress() {
    try {
        const raw = localStorage.getItem('quizProgress');
        const resumeBtn = document.getElementById('resume-last');
        const module1Resume = document.getElementById('module1-resume');
        const mixedResume = document.getElementById('mixed-resume');
        if (!raw) {
            if (resumeBtn) resumeBtn.classList.remove('hide'); // keep top-level resume visible but possibly inactive
            if (module1Resume) module1Resume.classList.add('hide');
            if (mixedResume) mixedResume.classList.add('hide');
            return;
        }
        const saved = JSON.parse(raw);
        if (resumeBtn) resumeBtn.classList.remove('hide');
        if (module1Resume) {
            if (saved.module === 'module1') module1Resume.classList.remove('hide'); else module1Resume.classList.add('hide');
        }
        if (mixedResume) {
            if (saved.module === 'mixed') mixedResume.classList.remove('hide'); else mixedResume.classList.add('hide');
        }
    } catch (e) {
        console.error('Error checking saved progress', e);
    }
}

function saveProgressDirect() {
    try {
        const snapshot = {
            module: appState.currentModule,
            currentIndex: appState.currentIndex,
            correct: appState.correct,
            timeLeft: appState.timeLeft,
            sessionSize: appState.sessionSize,
            questions: appState.questions,
            timestamp: Date.now()
        };
        const storageKey = `quizProgress_${appState.currentModule}`;
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch (e) { console.error(e); }
}

function resumeLast() {
    try {
        const raw = localStorage.getItem('quizProgress');
        if (!raw) { alert('No saved session found'); return; }
        const saved = JSON.parse(raw);
        resumeFromSaved(saved);
    } catch (e) { console.error(e); alert('Failed to resume session'); }
}

function resumeFromSaved(saved) {
    if (!saved || !saved.questions) { alert('Saved session is invalid'); return; }
    appState.currentModule = saved.module || null;
    appState.questions = saved.questions;
    appState.currentIndex = saved.currentIndex || 0;
    appState.correct = saved.correct || 0;
    appState.sessionSize = saved.sessionSize || appState.questions.length;
    appState.timeLeft = typeof saved.timeLeft === 'number' ? saved.timeLeft : calculateTimeForQuestions(appState.sessionSize);

    $('#module-selection').classList.add('hide');
    $('#quiz-container').classList.remove('hide');
    $('#module-name').textContent = appState.currentModule === 'mixed' ? 'Mixed' : (modulesData[appState.currentModule] ? modulesData[appState.currentModule].name : 'Module');
    $('#total-questions').textContent = appState.sessionSize;
    $('#total-questions-2').textContent = appState.sessionSize;
    $('#correct-score').textContent = appState.correct;
    $('#current-question').textContent = appState.currentIndex + 1;
    renderQuestion();
    startTimer();
}

function resumeModule(moduleKey) {
    try {
        const raw = localStorage.getItem('quizProgress');
        if (!raw) { alert('No saved session found'); return; }
        const saved = JSON.parse(raw);
        if (saved.module !== moduleKey) { alert('No saved session for this module'); return; }
        resumeFromSaved(saved);
    } catch (e) { console.error(e); alert('Failed to resume session for module'); }
}

function resumeMixed() { 
    resumeModule('mixed'); 
}

function resumeICAI() { 
    resumeModule('icai'); 
}