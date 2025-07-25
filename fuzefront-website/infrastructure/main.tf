terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Local values for consistent naming
locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Tags applied to all resources
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Purpose     = "fuzefront-website"
  }
}

# DATA SOURCES - Check for existing resources
data "aws_caller_identity" "current" {}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Check for existing Route53 zone - disabled due to multiple zones
data "aws_route53_zone" "existing" {
  count        = 0 # Disabled to avoid multiple zone conflicts
  name         = var.domain_name
  private_zone = false
}

# Check for existing ACM certificate - disabled due to multiple zones
data "aws_acm_certificate" "existing" {
  count       = 0 # Disabled to avoid multiple zone conflicts
  domain      = var.domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

# Check for existing security groups
data "aws_security_groups" "existing_alb" {
  filter {
    name   = "group-name"
    values = ["${local.name_prefix}-alb-sg"]
  }
}

data "aws_security_groups" "existing_ec2" {
  filter {
    name   = "group-name"
    values = ["${local.name_prefix}-ec2-sg"]
  }
}

# Try to get existing key pair (will return null if doesn't exist)
data "aws_key_pair" "existing" {
  count              = 0 # Disable data source approach for now
  key_name           = "${local.name_prefix}-key"
  include_public_key = true
}

# Import existing resources instead of recreating them
# These resources already exist and should be imported, not recreated

# APPLICATION LOAD BALANCER - Use existing
data "aws_lb" "main" {
  name = "${local.name_prefix}-alb"
}

# TARGET GROUP - Use existing
data "aws_lb_target_group" "main" {
  name = "${local.name_prefix}-tg"
}

# AUTO SCALING GROUP - Use existing
data "aws_autoscaling_group" "main" {
  name = "${local.name_prefix}-asg"
}

# ROUTE53 ZONE - Disabled due to multiple existing zones
resource "aws_route53_zone" "main" {
  count = 0 # Disabled to avoid multiple zone conflicts
  name  = var.domain_name

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-zone"
  })

  lifecycle {
    prevent_destroy = true
  }
}

# Route53 disabled - no zone management
locals {
  route53_zone_id = null
}

# ACM CERTIFICATE - Disabled due to multiple existing zones
resource "aws_acm_certificate" "main" {
  count                     = 0 # Disabled to avoid multiple zone conflicts
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-cert"
  })

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
  }
}

# Certificate disabled - no SSL management
locals {
  certificate_arn = null
}

# Certificate validation records - disabled
# resource "aws_route53_record" "cert_validation" {
#   for_each = {}  # Disabled due to multiple zones
#
#   allow_overwrite = true
#   name            = each.value.name
#   records         = [each.value.record]
#   ttl             = 60
#   type            = each.value.type
#   zone_id         = local.route53_zone_id
# }

# Certificate validation - disabled
# resource "aws_acm_certificate_validation" "main" {
#   count                   = 0  # Disabled due to multiple zones
#   certificate_arn         = null
#   validation_record_fqdns = []
#
#   timeouts {
#     create = "5m"
#   }
# }

# SECURITY GROUP FOR ALB - Create only if doesn't exist
resource "aws_security_group" "alb" {
  count       = length(data.aws_security_groups.existing_alb.ids) == 0 ? 1 : 0
  name        = "${local.name_prefix}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-alb-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Use existing or created ALB security group
locals {
  alb_security_group_id = length(data.aws_security_groups.existing_alb.ids) > 0 ? data.aws_security_groups.existing_alb.ids[0] : aws_security_group.alb[0].id
}

# SECURITY GROUP FOR EC2 - Create only if doesn't exist
resource "aws_security_group" "ec2" {
  count       = length(data.aws_security_groups.existing_ec2.ids) == 0 ? 1 : 0
  name        = "${local.name_prefix}-ec2-sg"
  description = "Security group for EC2 instances"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [local.alb_security_group_id]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.ssh_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-ec2-sg"
  })

  lifecycle {
    create_before_destroy = true
  }
}

# Use existing or created EC2 security group
locals {
  ec2_security_group_id = length(data.aws_security_groups.existing_ec2.ids) > 0 ? data.aws_security_groups.existing_ec2.ids[0] : aws_security_group.ec2[0].id
}

# KEY PAIR - Use existing key pair
data "aws_key_pair" "main" {
  key_name           = "${local.name_prefix}-key"
  include_public_key = true
}

# Use existing key pair
locals {
  key_name = data.aws_key_pair.main.key_name
}

# IAM ROLE FOR EC2 INSTANCES (SSM ACCESS) - Use existing
data "aws_iam_role" "ec2_ssm_role" {
  name = "${local.name_prefix}-ec2-ssm-role"
}

# Policy attachments already exist with the role - no need to manage them

# INSTANCE PROFILE - Use existing
data "aws_iam_instance_profile" "ec2_profile" {
  name = "${local.name_prefix}-ec2-profile"
}

# USER DATA SCRIPT
locals {
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    project_name = var.project_name
    domain_name  = var.domain_name
    email        = var.ssl_email
    AWS_REGION   = var.aws_region
    ACCOUNT_ID   = data.aws_caller_identity.current.account_id
    BACKEND_IMAGE = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/fuzefront-website-backend:latest" 
    FRONTEND_IMAGE = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/fuzefront-website-frontend:latest"
  }))
}

# LAUNCH TEMPLATE - Always create new version
resource "aws_launch_template" "main" {
  name_prefix   = "${local.name_prefix}-"
  image_id      = "ami-0c7217cdde317cfec" # Ubuntu 22.04 LTS  
  instance_type = var.instance_type
  key_name      = local.key_name

  vpc_security_group_ids = [local.ec2_security_group_id]

  iam_instance_profile {
    name = data.aws_iam_instance_profile.ec2_profile.name
  }

  user_data = local.user_data

  tag_specifications {
    resource_type = "instance"
    tags = merge(local.common_tags, {
      Name = "${local.name_prefix}-instance"
    })
  }

  lifecycle {
    create_before_destroy = true
    # Limit number of launch template versions to prevent accumulation
    ignore_changes = [name_prefix]
  }


  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-template"
  })
}

# TARGET GROUP - Use existing (imported via data source above)

# Use created target group and load balancer
locals {
  target_group_arn       = data.aws_lb_target_group.main.arn
  load_balancer_arn      = data.aws_lb.main.arn
  load_balancer_dns_name = data.aws_lb.main.dns_name
  load_balancer_zone_id  = data.aws_lb.main.zone_id
}

# ALB LISTENER - HTTP
# ALB HTTP Listener already exists - no need to manage

# ROUTE53 RECORDS - Disabled due to multiple zones
# resource "aws_route53_record" "main" {
#   count   = 0  # Disabled due to multiple zones
#   zone_id = local.route53_zone_id
#   name    = var.domain_name
#   type    = "A"
#
#   alias {
#     name                   = local.load_balancer_dns_name
#     zone_id                = local.load_balancer_zone_id
#     evaluate_target_health = true
#   }
# }
#
# resource "aws_route53_record" "www" {
#   count   = 0  # Disabled due to multiple zones
#   zone_id = local.route53_zone_id
#   name    = "www.${var.domain_name}"
#   type    = "A"
#
#   alias {
#     name                   = local.load_balancer_dns_name
#     zone_id                = local.load_balancer_zone_id
#     evaluate_target_health = true
#   }
# }