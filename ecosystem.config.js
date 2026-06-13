module.exports = {
	apps: [{
		name: 'panel-admin',
		script: './panel_admin',
		cwd: '/root/programacion/panel_admin',
		env: {
			PORT: '8080',
		},
		log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
		max_memory_restart: '128M',
		error_file: '/root/programacion/panel_admin/logs/err.log',
		out_file: '/root/programacion/panel_admin/logs/out.log',
		merge_logs: true,
	}],
};
