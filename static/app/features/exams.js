export async function loadExams(api, store) {
    const exams = await api.request('/exams?sort=date_desc');
    const grouped = {};
    for (const exam of exams) {
        if (!grouped[exam.level])
            grouped[exam.level] = [];
        grouped[exam.level].push(exam);
    }
    store.setState({ examsByLevel: grouped });
    window.__EXAMS_BY_LEVEL__ = grouped;
    return grouped;
}
//# sourceMappingURL=exams.js.map