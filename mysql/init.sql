-- Creates all ETL schemas and grants etluser full access
-- This script runs automatically on first MySQL container start

CREATE DATABASE IF NOT EXISTS `etl_meta`;
CREATE DATABASE IF NOT EXISTS `etl_raw`;
CREATE DATABASE IF NOT EXISTS `etl_dwd`;
CREATE DATABASE IF NOT EXISTS `etl_dws`;
CREATE DATABASE IF NOT EXISTS `etl_ads`;

GRANT ALL PRIVILEGES ON `etl_meta`.* TO 'etluser'@'%';
GRANT ALL PRIVILEGES ON `etl_raw`.* TO 'etluser'@'%';
GRANT ALL PRIVILEGES ON `etl_dwd`.* TO 'etluser'@'%';
GRANT ALL PRIVILEGES ON `etl_dws`.* TO 'etluser'@'%';
GRANT ALL PRIVILEGES ON `etl_ads`.* TO 'etluser'@'%';

FLUSH PRIVILEGES;
