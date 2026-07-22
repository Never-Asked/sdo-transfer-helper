// ==UserScript==
// @name         SDO - Помощник перезачета дисциплин
// @namespace    https://github.com/Never-Asked/sdo-transfer-helper
// @version      1.0.2
// @description  Сохраняет оценки, старый курс и сравнивает c актуальным курсом для перезачёта
// @author       NeverAsked
// @homepageURL  https://github.com/Never-Asked/sdo-transfer-helper
// @supportURL   https://github.com/Never-Asked/sdo-transfer-helper/issues
// @updateURL    https://raw.githubusercontent.com/Never-Asked/sdo-transfer-helper/main/sdo-transfer-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Never-Asked/sdo-transfer-helper/main/sdo-transfer-helper.user.js
// @match        https://sdo.nadpo.ru/*
// @match        https://sdo.ncrdo.ru/*
// @match        https://sdo.appkk.ru/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEYS = {
        grades: 'sdo_transfer_grades_v1',
        oldCourse: 'sdo_transfer_old_course_v1',
        lastReport: 'sdo_transfer_last_report_v1'
    };

    const PASS_PERCENT = 50;

    function normalizeText(text) {
        return (text || '')
            .replace(/\u00A0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeTitle(text) {
        return normalizeText(text)
            .toLowerCase()
            .replace(/^["«']|["»']$/g, '')
            .replace(/^\d+[\.\)]\s*/, '')
            .replace(/\(\s*\d+\s*ч\.?\s*\)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeTransferTitle(text) {
        return normalizeTitle(text)
            .replace(/^(итоговый\s+тест|итоговое\s+тестирование|итоговая\s+работа|итоговое\s+задание|итоговый\s+зач[её]т|дифференцированный\s+зач[её]т|итоговая\s+аттестация|контрольная\s+работа)\s*/i, '')
            .replace(/^\d+[\.\)]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseNumberRu(value) {
        const cleaned = normalizeText(value)
            .replace('%', '')
            .replace(',', '.')
            .replace(/[^\d.-]/g, '');

        if (!cleaned || cleaned === '-') return null;

        const num = Number(cleaned);
        return Number.isFinite(num) ? num : null;
    }

    function getMaxFromRange(rangeText) {
        const text = normalizeText(rangeText);
        const match = text.match(/[-–—]\s*(\d+(?:[,.]\d+)?)/);

        if (!match) return null;

        const value = Number(match[1].replace(',', '.'));
        return Number.isFinite(value) ? value : null;
    }

    function isGradePassed(gradeNumber, percentageNumber, rangeText) {
        if (percentageNumber !== null) {
            return percentageNumber >= PASS_PERCENT;
        }

        const maxGrade = getMaxFromRange(rangeText);

        if (gradeNumber !== null && maxGrade) {
            return (gradeNumber / maxGrade) * 100 >= PASS_PERCENT;
        }

        return false;
    }

    function getIdFromUrl(url) {
        if (!url) return '';

        try {
            const parsed = new URL(url, location.origin);
            return parsed.searchParams.get('id') || '';
        } catch (e) {
            return '';
        }
    }

    function extractCleanCellText(cell) {
        if (!cell) return '';

        const clone = cell.cloneNode(true);

        clone.querySelectorAll('.action-menu, .dropdown-menu, .visually-hidden, script, style')
            .forEach(el => el.remove());

        return normalizeText(clone.textContent);
    }

    // ---------- ОЦЕНКИ ----------

    function getGradeItemType(row) {
        const typeEl = row.querySelector('th.column-itemname span[title]');

        if (typeEl) {
            return normalizeText(typeEl.getAttribute('title') || typeEl.textContent);
        }

        const img = row.querySelector('th.column-itemname img.itemicon');

        if (img) {
            return normalizeText(img.getAttribute('alt') || img.getAttribute('title'));
        }

        return '';
    }

    function getGradeItemTitle(row) {
        const titleEl = row.querySelector('.rowtitle .gradeitemheader');
        return titleEl ? normalizeText(titleEl.textContent) : '';
    }

    function getGradeItemUrl(row) {
        const link = row.querySelector('.rowtitle a.gradeitemheader[href]');
        return link ? link.href : '';
    }

    function isIgnoredGradeTitle(title) {
        return [
            'Итоговая оценка за курс',
            'Оценка'
        ].includes(title);
    }

    function parseGradesPage() {
        const table = document.querySelector('table.user-grade');

        if (!table) {
            alert('Не нашёл таблицу оценок: table.user-grade');
            return [];
        }

        const rows = Array.from(table.querySelectorAll('tbody tr'));

        return rows
            .map(row => {
                const title = getGradeItemTitle(row);

                if (!title || isIgnoredGradeTitle(title)) {
                    return null;
                }

                const url = getGradeItemUrl(row);
                const gradeText = extractCleanCellText(row.querySelector('td.column-grade'));
                const rangeText = extractCleanCellText(row.querySelector('td.column-range'));
                const percentageText = extractCleanCellText(row.querySelector('td.column-percentage'));
                const feedbackText = extractCleanCellText(row.querySelector('td.column-feedback'));

                const gradeNumber = parseNumberRu(gradeText);
                const percentageNumber = parseNumberRu(percentageText);

                return {
                    type: getGradeItemType(row),
                    title,
                    normalizedTitle: normalizeTitle(title),
                    comparableTitle: normalizeTransferTitle(title),
                    moduleId: getIdFromUrl(url),
                    url,
                    grade: gradeText,
                    gradeNumber,
                    range: rangeText,
                    percentage: percentageText,
                    percentageNumber,
                    feedback: feedbackText,
                    passed: isGradePassed(gradeNumber, percentageNumber, rangeText)
                };
            })
            .filter(Boolean);
    }

    // ---------- КУРС ----------

    function cleanSectionTitle(title) {
        return normalizeText(title)
            .replace(/^\d+[\.\)]\s*/, '')
            .trim();
    }

    function isHiddenActivity(activityEl) {
        const activityItem = activityEl.querySelector('[data-region="activity-card"]');

        if (activityItem && activityItem.classList.contains('hiddenactivity')) {
            return true;
        }

        const hiddenBadge = activityEl.querySelector('.badge');

        if (hiddenBadge && normalizeText(hiddenBadge.textContent).includes('Скрыто от студентов')) {
            return true;
        }

        return false;
    }

    function getActivityType(activityEl) {
        const classes = Array.from(activityEl.classList);
        const modtypeClass = classes.find(cls => cls.startsWith('modtype_'));

        if (modtypeClass) {
            return modtypeClass.replace('modtype_', '');
        }

        const activityTitle = activityEl.querySelector('.activitytitle');

        if (activityTitle) {
            const titleClasses = Array.from(activityTitle.classList);
            const titleModtype = titleClasses.find(cls => cls.startsWith('modtype_'));

            if (titleModtype) {
                return titleModtype.replace('modtype_', '');
            }
        }

        return '';
    }

    function getActivityTitle(activityEl) {
        const nameEl =
            activityEl.querySelector('.activityname .instancename') ||
            activityEl.querySelector('[data-activityname]');

        if (!nameEl) return '';

        const clone = nameEl.cloneNode(true);
        clone.querySelectorAll('.accesshide, .visually-hidden').forEach(el => el.remove());

        return normalizeText(clone.textContent || nameEl.getAttribute('data-activityname'));
    }

    function getActivityUrl(activityEl) {
        const link =
            activityEl.querySelector('.activityname a[href]') ||
            activityEl.querySelector('a.aalink[href]') ||
            activityEl.querySelector('a[href*="/mod/"]');

        return link ? new URL(link.getAttribute('href'), location.origin).href : '';
    }

    function isFinalControlActivity(activity) {
        const title = normalizeTitle(activity.title);
        const type = activity.type;

        const controlTitlePatterns = [
            'итоговый тест',
            'итоговое тестирование',
            'итоговая работа',
            'итоговое задание',
            'итоговый зачет',
            'итоговый зачёт',
            'дифференцированный зачет',
            'дифференцированный зачёт',
            'итоговая аттестация',
            'контрольная работа'
        ];

        const isControlTitle = controlTitlePatterns.some(pattern => title.includes(pattern));

        const isSuitableType = [
            'quiz',
            'assign',
            'lesson',
            'scorm',
            'resource',
            'page',
            'url'
        ].includes(type);

        return isSuitableType && isControlTitle;
    }

    function makeTransferItem(section, activity, sourceKind) {
        return {
            sourceKind,
            sectionNumber: section.sectionNumber,
            sectionTitle: section.sectionTitle,
            normalizedSectionTitle: section.normalizedSectionTitle,
            sectionId: section.sectionId,
            moduleId: activity.moduleId,
            type: activity.type,
            title: activity.title,
            normalizedTitle: activity.normalizedTitle,
            comparableTitle: normalizeTransferTitle(activity.title || section.sectionTitle),
            url: activity.url
        };
    }

    function parseCoursePage() {
        const sectionEls = Array.from(document.querySelectorAll('.section-item'));

        if (!sectionEls.length) {
            alert('Не нашёл разделы курса: .section-item');
            return null;
        }

        const sections = sectionEls.map(sectionEl => {
            const header = sectionEl.querySelector('.course-section-header');
            const sectionTitleLink = sectionEl.querySelector('h3.sectionname a, .sectionname a');

            const rawSectionTitle = normalizeText(sectionTitleLink ? sectionTitleLink.textContent : '');
            const sectionTitle = cleanSectionTitle(rawSectionTitle);

            const sectionId =
                header?.getAttribute('data-id') ||
                sectionEl.querySelector('h3.sectionname')?.getAttribute('data-id') ||
                '';

            const sectionNumber =
                header?.getAttribute('data-number') ||
                sectionEl.querySelector('h3.sectionname')?.getAttribute('data-number') ||
                '';

            const sectionUrl = sectionTitleLink
                ? new URL(sectionTitleLink.getAttribute('href'), location.origin).href
                : '';

            const activityEls = Array.from(sectionEl.querySelectorAll('ul[data-for="cmlist"] > li.activity'));

            const activities = activityEls
                .map(activityEl => {
                    const type = getActivityType(activityEl);
                    const title = getActivityTitle(activityEl);
                    const url = getActivityUrl(activityEl);

                    const moduleId =
                        activityEl.getAttribute('data-id') ||
                        (activityEl.id || '').replace('module-', '') ||
                        getIdFromUrl(url);

                    return {
                        moduleId,
                        type,
                        title,
                        normalizedTitle: normalizeTitle(title),
                        comparableTitle: normalizeTransferTitle(title),
                        url,
                        hidden: isHiddenActivity(activityEl)
                    };
                })
                .filter(item => item.title);

            return {
                sectionId,
                sectionNumber,
                rawSectionTitle,
                sectionTitle,
                normalizedSectionTitle: normalizeTitle(sectionTitle),
                comparableSectionTitle: normalizeTransferTitle(sectionTitle),
                sectionUrl,
                activities
            };
        }).filter(section => section.sectionTitle || section.activities.length);

        const subcourses = sections.flatMap(section => {
            return section.activities
                .filter(activity => activity.type === 'subcourse')
                .filter(activity => !activity.hidden)
                .map(activity => makeTransferItem(section, activity, 'subcourse'));
        });

        const finalControls = sections.flatMap(section => {
            return section.activities
                .filter(activity => !activity.hidden)
                .filter(activity => isFinalControlActivity(activity))
                .map(activity => makeTransferItem(section, activity, 'final_control'));
        });

        const transferItems = [
            ...subcourses,
            ...finalControls
        ];

        return {
            pageUrl: location.href,
            parsedAt: new Date().toISOString(),
            sections,
            subcourses,
            finalControls,
            transferItems
        };
    }

    // ---------- СРАВНЕНИЕ ----------

    function similarity(a, b) {
        a = normalizeTransferTitle(a);
        b = normalizeTransferTitle(b);

        if (!a || !b) return 0;
        if (a === b) return 100;

        const aTokens = new Set(a.split(' ').filter(Boolean));
        const bTokens = new Set(b.split(' ').filter(Boolean));

        const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
        const union = new Set([...aTokens, ...bTokens]).size;

        if (!union) return 0;

        return Math.round((intersection / union) * 100);
    }

    function getOldItemsForCompare(oldCourse) {
        if (oldCourse.transferItems && oldCourse.transferItems.length) {
            return oldCourse.transferItems;
        }

        if (oldCourse.subcourses && oldCourse.subcourses.length) {
            return oldCourse.subcourses;
        }

        return [];
    }

    function getNewItemsForCompare(newCourse) {
        if (newCourse.subcourses && newCourse.subcourses.length) {
            return newCourse.subcourses;
        }

        if (newCourse.transferItems && newCourse.transferItems.length) {
            return newCourse.transferItems;
        }

        return [];
    }

    function findGradeForOldItem(grades, oldItem) {
        const gradeByModuleId = grades.find(grade =>
            grade.moduleId &&
            oldItem.moduleId &&
            grade.moduleId === oldItem.moduleId
        );

        if (gradeByModuleId) return gradeByModuleId;

        const gradeByExactTitle = grades.find(grade =>
            grade.normalizedTitle &&
            oldItem.normalizedTitle &&
            grade.normalizedTitle === oldItem.normalizedTitle
        );

        if (gradeByExactTitle) return gradeByExactTitle;

        const oldComparable = normalizeTransferTitle(oldItem.comparableTitle || oldItem.title || oldItem.sectionTitle);

        const gradeByComparableTitle = grades.find(grade =>
            normalizeTransferTitle(grade.comparableTitle || grade.title) === oldComparable
        );

        if (gradeByComparableTitle) return gradeByComparableTitle;

        const gradeBySectionTitle = grades.find(grade =>
            normalizeTransferTitle(grade.title) === normalizeTransferTitle(oldItem.sectionTitle)
        );

        if (gradeBySectionTitle) return gradeBySectionTitle;

        return null;
    }

    function compareCourses(grades, oldCourse, newCourse) {
        const oldItems = getOldItemsForCompare(oldCourse);
        const newItems = getNewItemsForCompare(newCourse);

        const oldItemsWithGrades = oldItems.map(oldItem => {
            const grade = findGradeForOldItem(grades, oldItem);

            return {
                ...oldItem,
                grade,
                hasPassedGrade: !!(grade && grade.passed)
            };
        });

        return newItems.map(newItem => {
            const newComparableTitle = normalizeTransferTitle(
                newItem.comparableTitle || newItem.title || newItem.sectionTitle
            );

            const matches = oldItemsWithGrades
                .map(oldItem => {
                    const oldComparableTitle = normalizeTransferTitle(
                        oldItem.comparableTitle || oldItem.title || oldItem.sectionTitle
                    );

                    const scoreByTitle = similarity(newComparableTitle, oldComparableTitle);
                    const scoreBySection = similarity(newItem.sectionTitle, oldItem.sectionTitle);
                    const score = Math.max(scoreByTitle, scoreBySection);

                    return {
                        oldItem,
                        score
                    };
                })
                .sort((a, b) => b.score - a.score);

            const best = matches[0];

            if (!best || best.score < 50) {
                return {
                    status: '❌ Не найдено',
                    newTitle: newItem.title,
                    oldTitle: '',
                    grade: '',
                    percentage: '',
                    score: 0,
                    sourceKind: '',
                    comment: 'В пройденном курсе не найдено похожего модуля или итогового контрольного элемента.'
                };
            }

            const gradeText = best.oldItem.grade ? best.oldItem.grade.grade : '';
            const percentageText = best.oldItem.grade ? best.oldItem.grade.percentage : '';

            const oldDisplayTitle = best.oldItem.sourceKind === 'final_control'
                ? `${best.oldItem.title} [итоговый элемент]`
                : best.oldItem.title;

            if (best.score >= 90 && best.oldItem.hasPassedGrade) {
                return {
                    status: '✅ Можно зачесть',
                    newTitle: newItem.title,
                    oldTitle: oldDisplayTitle,
                    grade: gradeText,
                    percentage: percentageText,
                    score: best.score,
                    sourceKind: best.oldItem.sourceKind || '',
                    comment: best.oldItem.sourceKind === 'final_control'
                        ? 'Найден итоговый контрольный элемент старого курса, соответствующий модулю. Оценка студента 50% или выше.'
                        : 'Модуль найден в пройденном курсе, совпадение уверенное, оценка студента 50% или выше.'
                };
            }

            if (best.score >= 90 && !best.oldItem.hasPassedGrade) {
                return {
                    status: '⚠️ Есть модуль, но нет зачётной оценки',
                    newTitle: newItem.title,
                    oldTitle: oldDisplayTitle,
                    grade: gradeText || '-',
                    percentage: percentageText || '-',
                    score: best.score,
                    sourceKind: best.oldItem.sourceKind || '',
                    comment: best.oldItem.sourceKind === 'final_control'
                        ? 'Итоговый элемент найден, но по нему нет оценки от 50%. Зачесть автоматически нельзя.'
                        : 'Модуль найден в пройденном курсе, но по нему нет оценки от 50%. Зачесть автоматически нельзя.'
                };
            }

            if (best.score >= 50 && best.oldItem.hasPassedGrade) {
                return {
                    status: '⚠️ Проверить',
                    newTitle: newItem.title,
                    oldTitle: oldDisplayTitle,
                    grade: gradeText,
                    percentage: percentageText,
                    score: best.score,
                    sourceKind: best.oldItem.sourceKind || '',
                    comment: 'Найден похожий модуль или итоговый элемент с оценкой от 50%, но совпадение не идеальное. Лучше проверить вручную.'
                };
            }

            return {
                status: '⚠️ Похожий модуль без зачётной оценки',
                newTitle: newItem.title,
                oldTitle: oldDisplayTitle,
                grade: gradeText || '-',
                percentage: percentageText || '-',
                score: best.score,
                sourceKind: best.oldItem.sourceKind || '',
                comment: 'В старом курсе найден похожий модуль или итоговый элемент, но нет подтверждённой оценки от 50%.'
            };
        });
    }

    // ---------- ДЕЙСТВИЯ ----------

    function saveGrades() {
        const grades = parseGradesPage();

        if (!grades.length) {
            alert('Оценки не собраны.');
            return;
        }

        localStorage.setItem(STORAGE_KEYS.grades, JSON.stringify({
            pageUrl: location.href,
            parsedAt: new Date().toISOString(),
            passPercent: PASS_PERCENT,
            items: grades
        }));

        alert(
            `Оценки сохранены.\n\n` +
            `Всего элементов: ${grades.length}\n` +
            `С оценкой от ${PASS_PERCENT}%: ${grades.filter(x => x.passed).length}`
        );
    }

    function saveOldCourse() {
        const course = parseCoursePage();

        if (!course) return;

        localStorage.setItem(STORAGE_KEYS.oldCourse, JSON.stringify(course));

        alert(
            `Старый курс сохранён.\n\n` +
            `Разделов: ${course.sections.length}\n` +
            `Субкурсов сохранено: ${course.subcourses.length}\n` +
            `Итоговых элементов сохранено: ${course.finalControls.length}\n` +
            `Всего элементов для сравнения: ${course.transferItems.length}`
        );
    }

    function compareWithCurrentCourse() {
        const gradesRaw = localStorage.getItem(STORAGE_KEYS.grades);
        const oldCourseRaw = localStorage.getItem(STORAGE_KEYS.oldCourse);

        if (!gradesRaw) {
            alert('Сначала открой страницу оценок и нажми “1. Сохранить оценки”.');
            return;
        }

        if (!oldCourseRaw) {
            alert('Сначала открой пройденный курс и нажми “2. Сохранить старый курс”.');
            return;
        }

        const grades = JSON.parse(gradesRaw).items;
        const oldCourse = JSON.parse(oldCourseRaw);
        const newCourse = parseCoursePage();

        if (!newCourse) return;

        const result = compareCourses(grades, oldCourse, newCourse);

        const rawData = {
            grades,
            oldCourse,
            newCourse
        };

        const textReport = buildTextReport(result);
        const shortSummary = buildShortTransferSummary(result);

        localStorage.setItem(STORAGE_KEYS.lastReport, JSON.stringify({
            createdAt: new Date().toISOString(),
            pageUrl: location.href,
            result,
            rawData,
            textReport,
            shortSummary
        }));

        showCompareModal(result, rawData);
    }

    function openLastReport() {
        const reportRaw = localStorage.getItem(STORAGE_KEYS.lastReport);

        if (!reportRaw) {
            alert('Сохранённого отчёта пока нет. Сначала выполни сравнение.');
            return;
        }

        const report = JSON.parse(reportRaw);

        showCompareModal(report.result, report.rawData);
    }

    function resetProgress() {
        const confirmed = confirm(
            'Сбросить сохранённые данные?\n\n' +
            'Будут удалены:\n' +
            '- оценки студента;\n' +
            '- старый курс;\n' +
            '- последний отчёт.\n\n' +
            'Это нужно делать перед сверкой другого курса.'
        );

        if (!confirmed) return;

        localStorage.removeItem(STORAGE_KEYS.grades);
        localStorage.removeItem(STORAGE_KEYS.oldCourse);
        localStorage.removeItem(STORAGE_KEYS.lastReport);

        alert('Данные сброшены. Можно начинать сверку другого курса.');
    }

    // ---------- ОТЧЁТ ----------

    function buildShortTransferSummary(result) {
        const canTransfer = result.filter(row => row.status.includes('Можно зачесть'));

        if (!canTransfer.length) {
            return 'К перезачету 0 модулей';
        }

        const titles = canTransfer.map(row => row.newTitle).join(', ');

        return `К перезачету ${canTransfer.length} ${declineModuleWord(canTransfer.length)}: ${titles}`;
    }

    function declineModuleWord(count) {
        const lastDigit = count % 10;
        const lastTwoDigits = count % 100;

        if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
            return 'модулей';
        }

        if (lastDigit === 1) {
            return 'модуль';
        }

        if (lastDigit >= 2 && lastDigit <= 4) {
            return 'модуля';
        }

        return 'модулей';
    }

    function buildTextReport(result) {
        const canTransfer = result.filter(row => row.status.includes('Можно зачесть'));
        const needCheck = result.filter(row => row.status.includes('Проверить'));
        const moduleNoGrade = result.filter(row => row.status.includes('нет зачётной оценки'));
        const similarNoGrade = result.filter(row => row.status.includes('Похожий модуль без зачётной оценки'));
        const notFound = result.filter(row => row.status.includes('Не найдено'));

        const lines = [];

        lines.push('Результат сравнения дисциплин для перезачёта');
        lines.push('');
        lines.push(`Критерий зачёта: оценка / процент от ${PASS_PERCENT}% и выше`);
        lines.push('');
        lines.push(buildShortTransferSummary(result));
        lines.push('');
        lines.push(`Можно зачесть: ${canTransfer.length}`);
        lines.push(`Требует проверки: ${needCheck.length}`);
        lines.push(`Модуль есть, но нет зачётной оценки: ${moduleNoGrade.length}`);
        lines.push(`Похожий модуль без зачётной оценки: ${similarNoGrade.length}`);
        lines.push(`Не найдено: ${notFound.length}`);
        lines.push('');

        if (canTransfer.length) {
            lines.push('Можно зачесть:');
            canTransfer.forEach(row => {
                lines.push(`- ${row.newTitle} ← ${row.oldTitle}, оценка: ${row.grade}, процент: ${row.percentage}, совпадение: ${row.score}%`);
            });
            lines.push('');
        }

        if (needCheck.length) {
            lines.push('Требует проверки:');
            needCheck.forEach(row => {
                lines.push(`- ${row.newTitle} ← ${row.oldTitle}, оценка: ${row.grade}, процент: ${row.percentage}, совпадение: ${row.score}%`);
            });
            lines.push('');
        }

        if (moduleNoGrade.length) {
            lines.push('Модуль есть, но нет зачётной оценки:');
            moduleNoGrade.forEach(row => {
                lines.push(`- ${row.newTitle} ← ${row.oldTitle}, оценка: ${row.grade}, процент: ${row.percentage}, совпадение: ${row.score}%`);
            });
            lines.push('');
        }

        if (similarNoGrade.length) {
            lines.push('Похожий модуль без зачётной оценки:');
            similarNoGrade.forEach(row => {
                lines.push(`- ${row.newTitle} ← ${row.oldTitle}, оценка: ${row.grade}, процент: ${row.percentage}, совпадение: ${row.score}%`);
            });
            lines.push('');
        }

        if (notFound.length) {
            lines.push('Не найдено подтверждения в пройденном курсе:');
            notFound.forEach(row => {
                lines.push(`- ${row.newTitle}`);
            });
            lines.push('');
        }

        return lines.join('\n');
    }

    function showCompareModal(result, rawData) {
        const oldModal = document.querySelector('#sdo-transfer-modal');
        if (oldModal) oldModal.remove();

        const overlay = document.createElement('div');
        overlay.id = 'sdo-transfer-modal';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '100000';
        overlay.style.background = 'rgba(0,0,0,.45)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const panel = document.createElement('div');
        panel.style.width = '92vw';
        panel.style.maxWidth = '1300px';
        panel.style.maxHeight = '85vh';
        panel.style.overflow = 'auto';
        panel.style.background = '#fff';
        panel.style.borderRadius = '12px';
        panel.style.padding = '20px';
        panel.style.boxShadow = '0 10px 40px rgba(0,0,0,.35)';
        panel.style.fontSize = '14px';
        panel.style.color = '#222';

        const canTransfer = result.filter(row => row.status.includes('Можно зачесть'));
        const needCheck = result.filter(row => row.status.includes('Проверить'));
        const moduleNoGrade = result.filter(row => row.status.includes('нет зачётной оценки'));
        const similarNoGrade = result.filter(row => row.status.includes('Похожий модуль без зачётной оценки'));
        const notFound = result.filter(row => row.status.includes('Не найдено'));

        const rowsHtml = result.map(row => `
            <tr>
                <td style="padding:8px;border-bottom:1px solid #ddd;white-space:nowrap;">${escapeHtml(row.status)}</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.newTitle)}</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.oldTitle)}</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.grade)}</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.percentage)}</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${row.score}%</td>
                <td style="padding:8px;border-bottom:1px solid #ddd;">${escapeHtml(row.comment)}</td>
            </tr>
        `).join('');

        const textReport = buildTextReport(result);
        const shortSummary = buildShortTransferSummary(result);

        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:16px;">
                <div>
                    <h2 style="margin:0;font-size:22px;">Результат сравнения для перезачёта</h2>
                    <div style="margin-top:4px;color:#555;">Критерий зачёта: ${PASS_PERCENT}% и выше</div>
                </div>
                <button id="sdo-transfer-close" style="border:none;background:#eee;padding:8px 12px;border-radius:8px;cursor:pointer;">Закрыть</button>
            </div>

            <div style="background:#f6f7f9;border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:14px;">
                <div style="font-weight:700;margin-bottom:6px;">Краткий итог:</div>
                <div style="font-size:15px;">${escapeHtml(shortSummary)}</div>
                <div style="margin-top:8px;color:#555;line-height:1.5;">
                    Можно зачесть: ${canTransfer.length} ·
                    Требует проверки: ${needCheck.length} ·
                    Модуль есть, но нет зачётной оценки: ${moduleNoGrade.length} ·
                    Похожий модуль без зачётной оценки: ${similarNoGrade.length} ·
                    Не найдено: ${notFound.length}
                </div>
            </div>

            <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
                <button id="sdo-transfer-copy-short-summary" style="border:none;background:#7a3db8;color:#fff;padding:9px 12px;border-radius:8px;cursor:pointer;">Скопировать краткий итог</button>
                <button id="sdo-transfer-copy-report" style="border:none;background:#245bdb;color:#fff;padding:9px 12px;border-radius:8px;cursor:pointer;">Скопировать отчёт</button>
                <button id="sdo-transfer-copy-json" style="border:none;background:#555;color:#fff;padding:9px 12px;border-radius:8px;cursor:pointer;">Скопировать JSON</button>
                <button id="sdo-transfer-download-report" style="border:none;background:#2f6f3e;color:#fff;padding:9px 12px;border-radius:8px;cursor:pointer;">Скачать TXT</button>
            </div>

            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f2f3f5;">
                        <th style="padding:8px;text-align:left;">Статус</th>
                        <th style="padding:8px;text-align:left;">Актуальный курс</th>
                        <th style="padding:8px;text-align:left;">Пройденный курс</th>
                        <th style="padding:8px;text-align:left;">Оценка</th>
                        <th style="padding:8px;text-align:left;">Процент</th>
                        <th style="padding:8px;text-align:left;">Совпадение</th>
                        <th style="padding:8px;text-align:left;">Комментарий</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        document.querySelector('#sdo-transfer-close').addEventListener('click', () => overlay.remove());

        document.querySelector('#sdo-transfer-copy-short-summary').addEventListener('click', () => {
            copyText(shortSummary);
            alert('Краткий итог скопирован.');
        });

        document.querySelector('#sdo-transfer-copy-report').addEventListener('click', () => {
            copyText(textReport);
            alert('Текстовый отчёт скопирован.');
        });

        document.querySelector('#sdo-transfer-copy-json').addEventListener('click', () => {
            copyText(JSON.stringify({
                result,
                rawData,
                shortSummary
            }, null, 2));
            alert('JSON скопирован.');
        });

        document.querySelector('#sdo-transfer-download-report').addEventListener('click', () => {
            const filename = `sdo-perezachet-report-${new Date().toISOString().slice(0, 10)}.txt`;
            downloadTextFile(filename, textReport);
        });
    }

    function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text);
        } else {
            navigator.clipboard.writeText(text);
        }
    }

    function downloadTextFile(filename, content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();

        URL.revokeObjectURL(url);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    // ---------- ПАНЕЛЬ ----------

    function addPanel() {
        if (document.querySelector('#sdo-transfer-panel')) return;

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = '←';
        toggleBtn.id = 'sdo-transfer-toggle';
        toggleBtn.style.position = 'fixed';
        toggleBtn.style.right = '20px';
        toggleBtn.style.top = '140px';
        toggleBtn.style.zIndex = '100000';
        toggleBtn.style.border = 'none';
        toggleBtn.style.borderRadius = '8px';
        toggleBtn.style.padding = '10px 14px';
        toggleBtn.style.background = '#111';
        toggleBtn.style.color = '#fff';
        toggleBtn.style.fontSize = '14px';
        toggleBtn.style.fontWeight = '600';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,.2)';

        const panel = document.createElement('div');
        panel.id = 'sdo-transfer-panel';
        panel.style.position = 'fixed';
        panel.style.right = '20px';
        panel.style.top = '190px';
        panel.style.zIndex = '99999';
        panel.style.display = 'none';
        panel.style.flexDirection = 'column';
        panel.style.gap = '8px';

        const buttons = [
            {
                text: '1. Сохранить оценки',
                color: '#245bdb',
                action: saveGrades
            },
            {
                text: '2. Сохранить старый курс',
                color: '#3d7c2f',
                action: saveOldCourse
            },
            {
                text: '3. Сравнить с актуальным',
                color: '#b83232',
                action: compareWithCurrentCourse
            },
            {
                text: 'Открыть последний отчёт',
                color: '#555',
                action: openLastReport
            },
            {
                text: 'Сбросить данные',
                color: '#111',
                action: resetProgress
            }
        ];

        buttons.forEach(item => {
            const btn = document.createElement('button');
            btn.textContent = item.text;
            btn.style.border = 'none';
            btn.style.borderRadius = '8px';
            btn.style.padding = '10px 14px';
            btn.style.background = item.color;
            btn.style.color = '#fff';
            btn.style.fontSize = '14px';
            btn.style.fontWeight = '600';
            btn.style.cursor = 'pointer';
            btn.style.boxShadow = '0 4px 12px rgba(0,0,0,.2)';
            btn.addEventListener('click', item.action);
            panel.appendChild(btn);
        });

        toggleBtn.addEventListener('click', () => {
            const isHidden = panel.style.display === 'none';

            panel.style.display = isHidden ? 'flex' : 'none';
            toggleBtn.textContent = isHidden ? '→' : '←';
        });

        document.body.appendChild(toggleBtn);
        document.body.appendChild(panel);
    }
    addPanel();
})();
